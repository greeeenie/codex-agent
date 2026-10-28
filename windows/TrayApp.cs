using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: System.Reflection.AssemblyTitle("Codex Agent")]
[assembly: System.Reflection.AssemblyDescription("Local agent for Codex Hub")]
[assembly: System.Reflection.AssemblyVersion("0.2.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("0.2.0.0")]
internal static class Program {
 internal const string BoardUrl="https://agent-board-stepan.readymars.chatgpt.site/";
 internal static string Root=AppDomain.CurrentDomain.BaseDirectory;
 internal static string Data=Environment.GetEnvironmentVariable("CODEX_AGENT_DATA_DIR")??Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"CodexAgent");
 [STAThread] static int Main(string[] args){
  string identity=WindowsIdentity.GetCurrent().User.Value;
  string mutexName="Local\\CodexAgent-"+identity,quitName=mutexName+"-quit";
  if(Array.IndexOf(args,"--shutdown")>=0){try{using(var quit=EventWaitHandle.OpenExisting(quitName))quit.Set();using(var running=Mutex.OpenExisting(mutexName)){if(running.WaitOne(15000))running.ReleaseMutex();}}catch(WaitHandleCannotBeOpenedException){}catch(AbandonedMutexException){}return 0;}
  foreach(string arg in args)if(arg.StartsWith("--self-test="))return SelfTest(arg.Substring(12));
  bool created;using(var single=new Mutex(true,mutexName,out created)){
   if(!created){if(Array.IndexOf(args,"--autostart")<0)Open(BoardUrl);return 0;}
   Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
   using(var quit=new EventWaitHandle(false,EventResetMode.ManualReset,quitName))
   using(var context=new TrayContext(quit,Array.IndexOf(args,"--autostart")>=0,Array.IndexOf(args,"--preview")>=0))Application.Run(context);
   single.ReleaseMutex();
  }return 0;
 }
 internal static ProcessStartInfo WorkerInfo(string script){
  var p=new ProcessStartInfo(Path.Combine(Root,"runtime","node","node.exe"),"\""+Path.Combine(Root,"runner",script)+"\"");
  p.WorkingDirectory=Root;p.UseShellExecute=false;p.CreateNoWindow=true;p.RedirectStandardInput=true;p.RedirectStandardOutput=true;p.RedirectStandardError=true;
  p.EnvironmentVariables["CODEX_AGENT_DATA_DIR"]=Data;
  p.EnvironmentVariables["PATH"]=Path.Combine(Root,"runtime","node")+";"+Environment.GetEnvironmentVariable("PATH");return p;
 }
 static int SelfTest(string output){try{var info=WorkerInfo("diagnostics.mjs");info.Arguments+=" \""+output+"\"";using(var process=Process.Start(info)){process.BeginOutputReadLine();process.BeginErrorReadLine();if(!process.WaitForExit(45000)){process.Kill();return 1;}return process.ExitCode;}}catch(Exception e){File.WriteAllText(output,new JavaScriptSerializer().Serialize(new {ok=false,error=e.Message}));return 1;}}
 internal static void Open(string target){try{Process.Start(new ProcessStartInfo(target){UseShellExecute=true});}catch{}}
}

internal sealed class TrayContext:ApplicationContext,IDisposable {
 readonly NotifyIcon tray;readonly ToolStripMenuItem statusItem;readonly Form window;readonly Label statusLabel;readonly System.Windows.Forms.Timer poll;
 readonly EventWaitHandle quit;Process worker;IntPtr job;bool exiting;bool workerError;string currentStatus="Подключаемся…";readonly bool preview;
 public TrayContext(EventWaitHandle quit,bool autoStart,bool preview){
  this.quit=quit;this.preview=preview;Directory.CreateDirectory(Program.Data);
  window=new Form{Text="Codex Agent",ClientSize=new Size(410,278),StartPosition=FormStartPosition.CenterScreen,FormBorderStyle=FormBorderStyle.FixedDialog,MaximizeBox=false,BackColor=Color.FromArgb(251,252,250),Font=new Font("Segoe UI",10),Icon=Icon.ExtractAssociatedIcon(Application.ExecutablePath)};
  var title=new Label{Text="Codex Agent",Location=new Point(29,27),AutoSize=true,Font=new Font("Segoe UI",19,FontStyle.Bold),ForeColor=Color.FromArgb(30,35,41)};
  statusLabel=new Label{Text=currentStatus,Location=new Point(31,82),Size=new Size(348,58),ForeColor=Color.FromArgb(106,115,119)};
  var open=new Button{Text="Открыть доску",Location=new Point(31,154),Size=new Size(230,40),BackColor=Color.FromArgb(31,35,41),ForeColor=Color.White,FlatStyle=FlatStyle.Flat};open.FlatAppearance.BorderSize=0;open.Click+=(s,e)=>Program.Open(Program.BoardUrl);
  var retry=new Button{Text="Повторить",Location=new Point(271,154),Size=new Size(107,40),FlatStyle=FlatStyle.Flat};retry.FlatAppearance.BorderColor=Color.FromArgb(220,224,225);retry.Click+=(s,e)=>Restart();
  var footer=new Label{Text="Работает в фоне. Закройте окно — агент останется в трее.",Location=new Point(31,215),Size=new Size(350,40),Font=new Font("Segoe UI",8),ForeColor=Color.FromArgb(146,154,157)};
  window.Controls.AddRange(new Control[]{title,statusLabel,open,retry,footer});
  IntPtr handle=window.Handle;
  window.FormClosing+=(s,e)=>{if(!exiting&&e.CloseReason==CloseReason.UserClosing){e.Cancel=true;window.Hide();}};
  var menu=new ContextMenuStrip();statusItem=new ToolStripMenuItem(currentStatus){Enabled=false};menu.Items.Add(statusItem);menu.Items.Add(new ToolStripSeparator());
  menu.Items.Add("Открыть доску",null,(s,e)=>Program.Open(Program.BoardUrl));menu.Items.Add("Состояние агента",null,(s,e)=>ShowWindow());menu.Items.Add("Перезапустить",null,(s,e)=>Restart());
  var startup=new ToolStripMenuItem("Запускать с Windows"){Checked=StartupEnabled(),CheckOnClick=true};startup.CheckedChanged+=(s,e)=>SetStartup(startup.Checked);menu.Items.Add(startup);
  menu.Items.Add(new ToolStripSeparator());menu.Items.Add("Выйти",null,(s,e)=>ExitThread());
  tray=new NotifyIcon{Text="Codex Agent",Icon=window.Icon,ContextMenuStrip=menu,Visible=true};tray.DoubleClick+=(s,e)=>ShowWindow();
  poll=new System.Windows.Forms.Timer{Interval=500};poll.Tick+=(s,e)=>{if(quit.WaitOne(0))ExitThread();};poll.Start();
  if(!autoStart)ShowWindow();if(preview)UpdateStatus("Компоненты установлены. Проверка интерфейса.");else StartWorker();
 }
 void ShowWindow(){window.Show();window.WindowState=FormWindowState.Normal;window.Activate();}
 void UpdateStatus(string message){currentStatus=message;statusLabel.Text=message;statusItem.Text=message;tray.Text="Codex Agent — "+(message.Length>43?message.Substring(0,43):message);}
 void Ui(Action action){if(exiting||window.IsDisposed)return;try{window.BeginInvoke(action);}catch(InvalidOperationException){}}
 void StartWorker(){try{
  workerError=false;UpdateStatus("Подключаемся…");var info=Program.WorkerInfo("start.mjs");info.Arguments+=" --desktop";worker=new Process{StartInfo=info,EnableRaisingEvents=true};
  worker.OutputDataReceived+=(s,e)=>HandleOutput(e.Data);worker.ErrorDataReceived+=(s,e)=>{if(!String.IsNullOrWhiteSpace(e.Data))Log(e.Data);};
  worker.Exited+=(s,e)=>Ui(()=>{if(!exiting&&!workerError)UpdateStatus("Агент остановлен. Нажмите «Повторить».");});
  job=Native.CreateKillJob();worker.Start();Native.Attach(job,worker.Handle);worker.BeginOutputReadLine();worker.BeginErrorReadLine();
 }catch(Exception e){StopWorker();UpdateStatus("Не удалось запустить агент. Нажмите «Повторить».");Log(e.Message);}}
 void HandleOutput(string line){if(String.IsNullOrWhiteSpace(line))return;try{var value=new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string,object>>(line);object kind,state;if(!value.TryGetValue("event",out kind)||kind.ToString()!="status"||!value.TryGetValue("state",out state))return;
  string message;switch(state.ToString()){case "ready":message="Агент готов к работе.";break;case "running":message="Codex выполняет задачу.";break;case "pairing":message="Подтвердите подключение в открывшемся браузере.";break;case "signing-in":message="Войдите в Codex в открывшемся браузере.";break;case "waiting-projects":message="Откройте проект в Codex. Агент подключит его автоматически.";break;case "missing-codex":workerError=true;message="Откройте установленный Codex и нажмите «Повторить».";break;case "error":workerError=true;message="Не удалось подключиться. Проверьте интернет и нажмите «Повторить».";break;default:message="Подключаемся…";break;}Ui(()=>UpdateStatus(message));
 }catch{Log(line);}}
 void Log(string message){try{File.AppendAllText(Path.Combine(Program.Data,"agent.log"),DateTime.UtcNow.ToString("s")+" "+message+Environment.NewLine);}catch{}}
 void Restart(){if(preview)return;StopWorker();StartWorker();}
 void StopWorker(){var child=worker;worker=null;if(child!=null){try{if(!child.HasExited){child.StandardInput.WriteLine("shutdown");child.StandardInput.Flush();child.WaitForExit(8000);}}catch{}finally{if(job!=IntPtr.Zero){Native.CloseHandle(job);job=IntPtr.Zero;}child.Dispose();}}else if(job!=IntPtr.Zero){Native.CloseHandle(job);job=IntPtr.Zero;}}
 static bool StartupEnabled(){using(var key=Registry.CurrentUser.OpenSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Run"))return key!=null&&key.GetValue("CodexAgent")!=null;}
 static void SetStartup(bool value){using(var key=Registry.CurrentUser.CreateSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Run")){if(value)key.SetValue("CodexAgent","\""+Application.ExecutablePath+"\" --autostart");else key.DeleteValue("CodexAgent",false);}}
 protected override void ExitThreadCore(){if(exiting)return;exiting=true;poll.Stop();StopWorker();tray.Visible=false;window.Close();base.ExitThreadCore();}
 protected override void Dispose(bool disposing){if(disposing){poll.Dispose();tray.Dispose();window.Dispose();}base.Dispose(disposing);}
}

internal static class Native {
 [StructLayout(LayoutKind.Sequential)]struct Basic{public long PerProcessUserTimeLimit,PerJobUserTimeLimit;public uint LimitFlags;public UIntPtr MinimumWorkingSetSize,MaximumWorkingSetSize;public uint ActiveProcessLimit;public UIntPtr Affinity;public uint PriorityClass,SchedulingClass;}
 [StructLayout(LayoutKind.Sequential)]struct Io{public ulong ReadOperationCount,WriteOperationCount,OtherOperationCount,ReadTransferCount,WriteTransferCount,OtherTransferCount;}
 [StructLayout(LayoutKind.Sequential)]struct Limits{public Basic BasicLimitInformation;public Io IoInfo;public UIntPtr ProcessMemoryLimit,JobMemoryLimit,PeakProcessMemoryUsed,PeakJobMemoryUsed;}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern IntPtr CreateJobObject(IntPtr attributes,string name);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool SetInformationJobObject(IntPtr job,int type,IntPtr info,uint size);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll")]internal static extern bool CloseHandle(IntPtr handle);
 internal static IntPtr CreateKillJob(){IntPtr job=CreateJobObject(IntPtr.Zero,null);var limits=new Limits();limits.BasicLimitInformation.LimitFlags=0x2000;int size=Marshal.SizeOf(limits);IntPtr p=Marshal.AllocHGlobal(size);try{Marshal.StructureToPtr(limits,p,false);if(job==IntPtr.Zero||!SetInformationJobObject(job,9,p,(uint)size)){if(job!=IntPtr.Zero)CloseHandle(job);throw new InvalidOperationException("Cannot create process job.");}}finally{Marshal.FreeHGlobal(p);}return job;}
 internal static void Attach(IntPtr job,IntPtr process){if(!AssignProcessToJobObject(job,process))throw new InvalidOperationException("Cannot track agent process tree.");}
}
