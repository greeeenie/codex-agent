using System;using System.Drawing;using System.Drawing.Drawing2D;using System.IO;using System.Runtime.InteropServices;
class MakeIcon{
 [DllImport("user32.dll")]static extern bool DestroyIcon(IntPtr icon);
 static void Main(string[] args){using(var bitmap=new Bitmap(64,64))using(var g=Graphics.FromImage(bitmap))using(var brush=new SolidBrush(Color.FromArgb(25,32,43))){g.SmoothingMode=SmoothingMode.AntiAlias;g.Clear(Color.Transparent);g.FillEllipse(brush,5,5,54,54);var handle=bitmap.GetHicon();try{using(var icon=Icon.FromHandle(handle))using(var output=File.Create(args[0]))icon.Save(output);}finally{DestroyIcon(handle);}}}
}
