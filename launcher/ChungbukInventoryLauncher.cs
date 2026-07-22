using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class ChungbukInventoryLauncher
{
    private const string AppUrl = "http://127.0.0.1:5177/";
    private static Process appProcess;
    private static Button openButton;
    private static Button stopButton;
    private static Label statusLabel;
    private static Timer processTimer;

    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        string appRoot = AppDomain.CurrentDomain.BaseDirectory;
        string nodePath = Path.Combine(appRoot, "runtime", "node", "node.exe");
        string scriptPath = Path.Combine(appRoot, "scripts", "start-portable.mjs");
        string dataDir = Path.Combine(appRoot, "user-data");

        if (!File.Exists(nodePath))
        {
            MessageBox.Show(
                "runtime\\node\\node.exe 파일이 없습니다. 전체 배포 폴더를 그대로 사용해 주세요.",
                "충북 재고관리",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }

        if (!File.Exists(scriptPath))
        {
            MessageBox.Show(
                "scripts\\start-portable.mjs 파일이 없습니다. 전체 배포 폴더를 그대로 사용해 주세요.",
                "충북 재고관리",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }

        try
        {
            Directory.CreateDirectory(Path.Combine(dataDir, "backups"));
            StartApp(nodePath, scriptPath, appRoot, dataDir);
        }
        catch (Exception error)
        {
            MessageBox.Show(
                "앱을 시작하지 못했습니다.\n\n" + error.Message,
                "충북 재고관리",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }

        using (Form form = BuildForm())
        {
            processTimer = new Timer();
            processTimer.Interval = 1000;
            processTimer.Tick += delegate { UpdateProcessStatus(); };
            processTimer.Start();

            form.FormClosing += delegate { StopApp(); };
            Application.Run(form);
        }
    }

    private static void StartApp(string nodePath, string scriptPath, string appRoot, string dataDir)
    {
        ProcessStartInfo info = new ProcessStartInfo();
        info.FileName = nodePath;
        info.Arguments = Quote(scriptPath);
        info.WorkingDirectory = appRoot;
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.WindowStyle = ProcessWindowStyle.Hidden;
        info.EnvironmentVariables["CHUNGBUK_DATA_DIR"] = dataDir;

        appProcess = Process.Start(info);
    }

    private static Form BuildForm()
    {
        Form form = new Form();
        form.Text = "충북 재고관리";
        form.Width = 430;
        form.Height = 170;
        form.FormBorderStyle = FormBorderStyle.FixedDialog;
        form.MaximizeBox = false;
        form.StartPosition = FormStartPosition.CenterScreen;

        statusLabel = new Label();
        statusLabel.Left = 18;
        statusLabel.Top = 18;
        statusLabel.Width = 380;
        statusLabel.Height = 42;
        statusLabel.Text = "충북 재고관리 앱이 실행 중입니다.\n이 창을 닫으면 앱이 종료됩니다.";
        form.Controls.Add(statusLabel);

        openButton = new Button();
        openButton.Left = 18;
        openButton.Top = 78;
        openButton.Width = 140;
        openButton.Height = 32;
        openButton.Text = "브라우저 열기";
        openButton.Click += delegate { OpenBrowser(); };
        form.Controls.Add(openButton);

        stopButton = new Button();
        stopButton.Left = 170;
        stopButton.Top = 78;
        stopButton.Width = 110;
        stopButton.Height = 32;
        stopButton.Text = "종료";
        stopButton.Click += delegate { form.Close(); };
        form.Controls.Add(stopButton);

        return form;
    }

    private static void UpdateProcessStatus()
    {
        if (appProcess == null || appProcess.HasExited)
        {
            statusLabel.Text = "앱이 중지되었습니다.";
            openButton.Enabled = false;
            stopButton.Text = "닫기";
            processTimer.Stop();
        }
    }

    private static void OpenBrowser()
    {
        ProcessStartInfo info = new ProcessStartInfo();
        info.FileName = AppUrl;
        info.UseShellExecute = true;
        Process.Start(info);
    }

    private static void StopApp()
    {
        if (processTimer != null)
        {
            processTimer.Stop();
        }

        if (appProcess == null)
        {
            return;
        }

        try
        {
            if (!appProcess.HasExited)
            {
                appProcess.Kill();
                appProcess.WaitForExit(3000);
            }
        }
        catch
        {
            // The process may already be gone. The launcher should still close.
        }
        finally
        {
            appProcess.Dispose();
            appProcess = null;
        }
    }

    private static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }
}
