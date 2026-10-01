using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public class BlockyBackgroundDesktop {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public struct SI { public int cb; public string reserved,desktop,title; public int x,y,w,h,charsX,charsY,fill,flags; public short show,reserved2; public IntPtr reservedPtr,input,output,error; }
 [StructLayout(LayoutKind.Sequential)] public struct PI {public IntPtr process,thread;public uint pid,tid;}
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern IntPtr CreateDesktopW(string name,IntPtr dev,IntPtr mode,uint flags,uint access,IntPtr sa);
 [DllImport("user32.dll",SetLastError=true)] public static extern bool CloseDesktop(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern IntPtr GetThreadDesktop(uint tid);
 [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool GetUserObjectInformationW(IntPtr h,int index,StringBuilder text,int size,out int needed);
 public static string DesktopName(IntPtr h) {int n;var b=new StringBuilder(512);if(!GetUserObjectInformationW(h,2,b,1024,out n))throw new System.ComponentModel.Win32Exception();return b.ToString();}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern bool CreateProcessW(string app,StringBuilder args,IntPtr psa,IntPtr tsa,bool inherit,uint flags,IntPtr env,string cwd,ref SI si,out PI pi);
 [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern IntPtr CreateJobObjectW(IntPtr sa,string name);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool SetInformationJobObject(IntPtr job,int info,IntPtr data,uint size);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern uint ResumeThread(IntPtr thread);
 [StructLayout(LayoutKind.Sequential)] public struct BasicLimits {public long perProcess,perJob;public uint flags;public UIntPtr minWs,maxWs;public uint active;public UIntPtr affinity;public uint priority,scheduling;}
 [StructLayout(LayoutKind.Sequential)] public struct ExtendedLimits {public BasicLimits basic;public ulong io1,io2,io3,io4,io5,io6;public UIntPtr processMemory,jobMemory,peakProcess,peakJob;}
 public static IntPtr KillOnCloseJob() {var j=CreateJobObjectW(IntPtr.Zero,null);if(j==IntPtr.Zero)throw new System.ComponentModel.Win32Exception();var v=new ExtendedLimits();v.basic.flags=0x2000;int n=Marshal.SizeOf(v);var p=Marshal.AllocHGlobal(n);try {Marshal.StructureToPtr(v,p,false);if(!SetInformationJobObject(j,9,p,(uint)n))throw new System.ComponentModel.Win32Exception();}catch{CloseHandle(j);throw;}finally{Marshal.FreeHGlobal(p);}return j;}
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
 public delegate bool EnumFn(IntPtr hwnd,IntPtr l);
 [DllImport("user32.dll",SetLastError=true)] static extern bool EnumDesktopWindows(IntPtr desktop,EnumFn callback,IntPtr l);
 public static string[] OwnWindows(IntPtr desktop,uint ownPid) {var list=new List<string>(); EnumFn fn=(h,l)=>{uint p;uint t=GetWindowThreadProcessId(h,out p);if(p==ownPid) list.Add(h+":"+t+":"+IsWindowVisible(h)+":"+IsIconic(h));return true;}; if(!EnumDesktopWindows(desktop,fn,IntPtr.Zero))throw new System.ComponentModel.Win32Exception();return list.ToArray();}
 [DllImport("kernel32.dll",SetLastError=true)] public static extern uint WaitForSingleObject(IntPtr process,uint timeout);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool GetExitCodeProcess(IntPtr process,out uint code);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool TerminateProcess(IntPtr process,uint code);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int info,IntPtr data,uint size,out uint written);
 public static uint[] JobPids(IntPtr job) {
  const int capacity=1024; int size=8+IntPtr.Size*capacity; var p=Marshal.AllocHGlobal(size);
  try {uint written;if(!QueryInformationJobObject(job,3,p,(uint)size,out written))throw new System.ComponentModel.Win32Exception();int count=Marshal.ReadInt32(p,4);if(count<0||count>capacity)throw new InvalidOperationException("Job PID bound exceeded");var ids=new uint[count];for(int i=0;i<count;i++)ids[i]=checked((uint)Marshal.ReadIntPtr(p,8+i*IntPtr.Size).ToInt64());return ids;}
  finally {Marshal.FreeHGlobal(p);}
 }
 public static string QuoteArgument(string value) {
  var output=new StringBuilder("\"");int slash=0;
  foreach(char c in value){if(c=='\\'){slash++;continue;}if(c=='"'){output.Append('\\',slash*2+1);output.Append(c);}else{output.Append('\\',slash);output.Append(c);}slash=0;}
  output.Append('\\',slash*2);output.Append('"');return output.ToString();
 }
}