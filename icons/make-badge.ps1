# Turns icons\badge-source.webp (pixel-art logo on a dark background) into icons\badge.png:
# finds the logo, samples one colour per pixel-art "cell" so it stays perfectly sharp, and makes
# the dark background transparent. Usage: powershell -STA -File make-badge.ps1 [cellSize]
param([double]$cell = 0)
Add-Type -AssemblyName PresentationCore, WindowsBase
Add-Type -ReferencedAssemblies PresentationCore, WindowsBase, System.Xaml -TypeDefinition @'
using System; using System.IO; using System.Windows.Media; using System.Windows.Media.Imaging;
public static class Badge {
  public static string Build(string src, string outPath, double cell) {
    var dec = BitmapDecoder.Create(new Uri(src), BitmapCreateOptions.PreservePixelFormat, BitmapCacheOption.OnLoad);
    var bmp = new FormatConvertedBitmap(dec.Frames[0], PixelFormats.Bgra32, null, 0);
    int w = bmp.PixelWidth, h = bmp.PixelHeight, st = w * 4; var px = new byte[h * st]; bmp.CopyPixels(px, st, 0);
    // background colour = the corner pixel
    int br = px[2], bg = px[1], bb = px[0];
    Func<int,int,bool> isBg = (x, y) => { int i = y * st + x * 4; return Math.Abs(px[i+2]-br) + Math.Abs(px[i+1]-bg) + Math.Abs(px[i]-bb) < 40; };
    int L = w, T = h, R = 0, B = 0;
    for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) if (!isBg(x, y)) { if (x < L) L = x; if (x > R) R = x; if (y < T) T = y; if (y > B) B = y; }
    // cell size: shortest run of identical colour along the middle row/column, if not given
    if (cell <= 0) {
      int best = 9999, run = 1, prev = -1;
      for (int x = L; x <= R; x++) { int i = ((T + B) / 2) * st + x * 4; int c = px[i] << 16 | px[i+1] << 8 | px[i+2];
        if (Math.Abs(c - prev) < 1) run++; else { if (run >= 8 && run < best) best = run; run = 1; } prev = c; }
      cell = best < 9999 ? best : 30;
    }
    int cols = (int)Math.Round((R - L + 1) / cell), rows = (int)Math.Round((B - T + 1) / cell);
    double cw = (R - L + 1) / (double)cols, ch = (B - T + 1) / (double)rows;
    int n = Math.Max(cols, rows); var o = new byte[n * n * 4]; int ox = (n - cols) / 2, oy = (n - rows) / 2;
    for (int r = 0; r < rows; r++) for (int c = 0; c < cols; c++) {
      int sx = (int)(L + (c + 0.5) * cw), sy = (int)(T + (r + 0.5) * ch);
      int i = sy * st + sx * 4, j = ((r + oy) * n + c + ox) * 4;
      if (isBg(sx, sy)) continue;
      o[j] = px[i]; o[j+1] = px[i+1]; o[j+2] = px[i+2]; o[j+3] = 255;
    }
    var outBmp = BitmapSource.Create(n, n, 96, 96, PixelFormats.Bgra32, null, o, n * 4);
    var enc = new PngBitmapEncoder(); enc.Frames.Add(BitmapFrame.Create(outBmp));
    using (var fs = File.Create(outPath)) enc.Save(fs);
    return string.Format("logo {0}x{1}px at {2},{3}; cell {4:F1}px -> {5}x{6} pixels, saved {7}x{7}", R-L+1, B-T+1, L, T, cell, cols, rows, n);
  }
}
'@
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
[Badge]::Build((Join-Path $dir 'badge-source.webp'), (Join-Path $dir 'badge.png'), $cell)
