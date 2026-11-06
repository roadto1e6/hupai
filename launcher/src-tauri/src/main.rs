#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{io::{BufRead,BufReader,Write},path::PathBuf,process::{Child,ChildStdin,Command,Stdio},sync::{Mutex,atomic::{AtomicU64,Ordering}},thread,time::Duration};
use std::os::windows::{io::AsRawHandle,process::CommandExt};
use serde::{Deserialize,Serialize};
use tauri::{Emitter,Manager,State,WebviewUrl,WebviewWindow,WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;
use windows_sys::Win32::{Foundation::CloseHandle,System::JobObjects::*};

#[derive(Clone,Default,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
struct Status{phase:String,local_url:String,public_url:String,message:String}
struct Job(usize);
impl Job{
    fn new()->Result<Self,String>{unsafe{
        let handle=CreateJobObjectW(std::ptr::null(),std::ptr::null());
        if handle.is_null(){return Err("无法创建服务进程组".into())}
        let mut limits:JOBOBJECT_EXTENDED_LIMIT_INFORMATION=std::mem::zeroed();
        limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(handle,JobObjectExtendedLimitInformation,&limits as *const _ as _,std::mem::size_of_val(&limits) as u32)==0{CloseHandle(handle);return Err("无法管理服务进程组".into())}
        Ok(Self(handle as usize))
    }}
    fn add(&self,child:&Child)->Result<(),String>{unsafe{if AssignProcessToJobObject(self.0 as _,child.as_raw_handle() as _)==0{return Err("无法管理游戏服务".into())}}Ok(())}
}
impl Drop for Job{fn drop(&mut self){unsafe{CloseHandle(self.0 as _);}}}
struct Host{child:Child,input:ChildStdin,_job:Job}
struct Runtime{host:Mutex<Option<Host>>,status:Mutex<Status>,epoch:AtomicU64,data:PathBuf,resources:PathBuf}
fn only_launcher(window:&WebviewWindow)->Result<(),String>{if window.label()!="main"{Err("此操作仅可由启动器执行".into())}else{Ok(())}}
fn set_status(app:&tauri::AppHandle,value:Status){*app.state::<Runtime>().status.lock().unwrap()=value.clone();let _=app.emit_to("main","service-status",value);}
fn launch(app:&tauri::AppHandle)->Result<(),String>{
    let state=app.state::<Runtime>();
    let mut slot=state.host.lock().map_err(|e|e.to_string())?;
    if let Some(host)=slot.as_mut(){if host.child.try_wait().map_err(|e|e.to_string())?.is_none(){writeln!(host.input,"{{\"command\":\"start\"}}").map_err(|e|e.to_string())?;return Ok(())}}
    *slot=None;
    std::fs::create_dir_all(&state.data).map_err(|e|e.to_string())?;
    let job=Job::new()?;
    let mut child=Command::new(state.resources.join("bin/node.exe"))
        .arg(state.resources.join("supervisor.cjs")).current_dir(&state.resources)
        .env("HUPAI_DATA_DIR",&state.data).creation_flags(0x08000000)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e|format!("游戏服务无法启动：{e}"))?;
    if let Err(error)=job.add(&child){let _=child.kill();return Err(error)}
    let input=child.stdin.take().ok_or("无法连接服务")?;
    let output=child.stdout.take().ok_or("无法读取服务状态")?;
    let errors=child.stderr.take().ok_or("无法读取服务日志")?;
    let epoch=state.epoch.fetch_add(1,Ordering::SeqCst)+1;
    *slot=Some(Host{child,input,_job:job});drop(slot);
    let app2=app.clone();
    thread::spawn(move||{
        for line in BufReader::new(output).lines().map_while(Result::ok){
            if app2.state::<Runtime>().epoch.load(Ordering::SeqCst)!=epoch{return}
            if let Ok(value)=serde_json::from_str::<Status>(&line){set_status(&app2,value)}
        }
        if app2.state::<Runtime>().epoch.load(Ordering::SeqCst)==epoch{set_status(&app2,Status{phase:"error".into(),message:"游戏服务已停止，可重新启动。".into(),..Default::default()})}
    });
    let log=state.data.join("service-errors.log");
    thread::spawn(move||{if let Ok(mut file)=std::fs::OpenOptions::new().create(true).append(true).open(log){for line in BufReader::new(errors).lines().map_while(Result::ok){let _=writeln!(file,"{line}");}}});
    Ok(())
}
fn cleanup(app:&tauri::AppHandle){
    let state=app.state::<Runtime>();state.epoch.fetch_add(1,Ordering::SeqCst);
    let owned_host=state.host.lock().unwrap().take();
    if let Some(mut host)=owned_host{
        let _=writeln!(host.input,"{{\"command\":\"shutdown\"}}");
        for _ in 0..20 {if matches!(host.child.try_wait(),Ok(Some(_))){return}thread::sleep(Duration::from_millis(50));}
        let _=host.child.kill();let _=host.child.wait();
    }
}
#[tauri::command]
fn get_status(window:WebviewWindow,state:State<Runtime>)->Result<Status,String>{only_launcher(&window)?;Ok(state.status.lock().unwrap().clone())}
#[tauri::command]
fn start_service(window:WebviewWindow,app:tauri::AppHandle)->Result<(),String>{only_launcher(&window)?;launch(&app)}
#[tauri::command]
fn stop_service(window:WebviewWindow,state:State<Runtime>)->Result<(),String>{
    only_launcher(&window)?;
    if let Some(host)=state.host.lock().unwrap().as_mut(){writeln!(host.input,"{{\"command\":\"stop\"}}").map_err(|e|e.to_string())?}Ok(())
}
#[tauri::command]
fn copy_link(window:WebviewWindow,app:tauri::AppHandle)->Result<(),String>{
    only_launcher(&window)?;let link=app.state::<Runtime>().status.lock().unwrap().public_url.clone();
    if link.is_empty(){return Err("公网链接尚未就绪".into())}app.clipboard().write_text(link).map_err(|e|e.to_string())
}
#[tauri::command]
fn open_game(window:WebviewWindow,app:tauri::AppHandle,local:bool)->Result<(),String>{
    only_launcher(&window)?;
    let status=app.state::<Runtime>().status.lock().unwrap().clone();
    let address=if local{status.local_url}else{status.public_url};
    if address.is_empty(){return Err("牌桌还未准备好".into())}
    // Launch only a validated service URL in the user's default browser.
    tauri_plugin_opener::OpenerExt::opener(&app).open_url(address, None::<&str>).map_err(|e|e.to_string())?;
    Ok(())
}
#[tauri::command]
fn quit_app(window:WebviewWindow,app:tauri::AppHandle)->Result<(),String>{only_launcher(&window)?;app.exit(0);Ok(())}
include!(concat!(env!("OUT_DIR"), "/payload.rs"));
fn unpack(data:&std::path::Path)->std::io::Result<PathBuf>{
 use std::hash::{Hash,Hasher};
 let mut hash=std::collections::hash_map::DefaultHasher::new();
 for (name,bytes) in FILES{name.hash(&mut hash);bytes.hash(&mut hash)}
 let root=data.join("runtime").join(format!("{:016x}",hash.finish()));
 for (name,bytes) in FILES{let file=root.join(name);let valid=std::fs::read(&file).map(|old|old.as_slice()==*bytes).unwrap_or(false);if !valid{std::fs::create_dir_all(file.parent().unwrap())?;let tmp=file.with_extension("unpack-tmp");std::fs::write(&tmp,bytes)?;std::fs::rename(tmp,file)?}}
 Ok(root)
}
fn main(){
    let app=tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app,_,_|{if let Some(window)=app.get_webview_window("main"){let _=window.show();let _=window.unminimize();let _=window.set_focus();}}))
        .plugin(tauri_plugin_clipboard_manager::init()).plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_status,start_service,stop_service,copy_link,open_game,quit_app])
        .setup(|app|{
            let data=std::env::var_os("HUPAI_DATA_DIR").map(PathBuf::from).unwrap_or(app.path().app_data_dir()?);
            let resources=unpack(&data)?;
            app.manage(Runtime{host:Mutex::new(None),status:Mutex::new(Status{phase:"starting".into(),..Default::default()}),epoch:AtomicU64::new(0),data,resources});
            if let Err(message)=launch(app.handle()){set_status(app.handle(),Status{phase:"error".into(),message,..Default::default()});}
            Ok(())
        })
        .build(tauri::generate_context!()).expect("无法启动唬牌");
    app.run(|app,event|{if let tauri::RunEvent::Exit=event{cleanup(app)}});
}
