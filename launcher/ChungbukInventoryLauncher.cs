using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;

internal static class ChungbukInventoryLauncher
{
    private const string AppUrl = "http://127.0.0.1:5177/";
    private const string LatestReleaseUrl = "https://api.github.com/repos/pyb0987/chungbuk-inventory-app/releases/latest";
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
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;

        string appRoot = AppDomain.CurrentDomain.BaseDirectory;
        string nodePath = Path.Combine(appRoot, "runtime", "node", "node.exe");
        string scriptPath = Path.Combine(appRoot, "scripts", "start-portable.mjs");
        string dataDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "ChungbukInventory");

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
            MigrateLegacyUserData(appRoot, dataDir);
            Directory.CreateDirectory(Path.Combine(dataDir, "backups"));
            if (OfferUpdateIfAvailable(appRoot, dataDir))
            {
                return;
            }
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

    private static void MigrateLegacyUserData(string appRoot, string dataDir)
    {
        string legacyDir = Path.Combine(appRoot, "user-data");
        string targetDatabase = Path.Combine(dataDir, "chungbuk-inventory.sqlite");
        string legacyDatabase = Path.Combine(legacyDir, "chungbuk-inventory.sqlite");

        Directory.CreateDirectory(dataDir);
        if (!File.Exists(targetDatabase) && File.Exists(legacyDatabase))
        {
            CopyDirectory(legacyDir, dataDir);
            MessageBox.Show(
                "기존 재고 데이터를 안전한 Windows 사용자 데이터 폴더로 옮겼습니다.\n\n" + dataDir,
                "충북 재고관리",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
        }
    }

    private static bool OfferUpdateIfAvailable(string appRoot, string dataDir)
    {
        try
        {
            string currentVersionText = ReadCurrentVersion(appRoot);
            ReleaseInfo release = GetLatestRelease();
            if (release == null || !IsNewerVersion(release.Version, currentVersionText))
            {
                return false;
            }

            DialogResult answer = MessageBox.Show(
                "새 버전 " + release.Version + "이 있습니다. 현재 버전은 " + currentVersionText + "입니다.\n\n" +
                "데이터베이스를 백업한 뒤 업데이트하고 다시 시작할까요?",
                "충북 재고관리 업데이트",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question);
            if (answer != DialogResult.Yes)
            {
                return false;
            }

            BackupDatabaseBeforeUpdate(dataDir, currentVersionText);
            string archivePath = Path.Combine(
                Path.GetTempPath(),
                "ChungbukInventory-" + release.Version + "-" + Guid.NewGuid().ToString("N") + ".zip");
            DownloadFile(release.DownloadUrl, archivePath);
            StartUpdater(appRoot, archivePath);
            return true;
        }
        catch (Exception error)
        {
            MessageBox.Show(
                "업데이트 확인을 완료하지 못했습니다. 기존 버전으로 계속 실행합니다.\n\n" + error.Message,
                "충북 재고관리",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
            return false;
        }
    }

    private static string ReadCurrentVersion(string appRoot)
    {
        string versionPath = Path.Combine(appRoot, "APP_VERSION");
        return File.Exists(versionPath) ? File.ReadAllText(versionPath).Trim() : "0.0.0";
    }

    private static ReleaseInfo GetLatestRelease()
    {
        HttpWebRequest request = (HttpWebRequest)WebRequest.Create(LatestReleaseUrl);
        request.UserAgent = "ChungbukInventory";
        request.Accept = "application/vnd.github+json";
        request.Timeout = 5000;
        request.ReadWriteTimeout = 5000;

        string json;
        using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
        using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
        {
            json = reader.ReadToEnd();
        }

        Match tag = Regex.Match(json, "\"tag_name\"\\s*:\\s*\"v?([^\"]+)\"");
        Match asset = Regex.Match(
            json,
            "\"browser_download_url\"\\s*:\\s*\"([^\"]*chungbuk-inventory-portable-release\\.zip)\"",
            RegexOptions.IgnoreCase);
        if (!tag.Success || !asset.Success)
        {
            return null;
        }
        return new ReleaseInfo(tag.Groups[1].Value, asset.Groups[1].Value.Replace("\\/", "/"));
    }

    private static bool IsNewerVersion(string candidate, string current)
    {
        Version candidateVersion;
        Version currentVersion;
        return Version.TryParse(candidate, out candidateVersion) &&
            Version.TryParse(current, out currentVersion) &&
            candidateVersion.CompareTo(currentVersion) > 0;
    }

    private static void BackupDatabaseBeforeUpdate(string dataDir, string currentVersion)
    {
        string databasePath = Path.Combine(dataDir, "chungbuk-inventory.sqlite");
        if (!File.Exists(databasePath))
        {
            return;
        }
        string backupDir = Path.Combine(dataDir, "backups");
        Directory.CreateDirectory(backupDir);
        string stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
        File.Copy(
            databasePath,
            Path.Combine(backupDir, "before-update-" + currentVersion + "-" + stamp + ".sqlite"),
            true);
    }

    private static void DownloadFile(string url, string targetPath)
    {
        using (WebClient client = new WebClient())
        {
            client.Headers.Add(HttpRequestHeader.UserAgent, "ChungbukInventory");
            client.DownloadFile(url, targetPath);
        }
    }

    private static void StartUpdater(string appRoot, string archivePath)
    {
        string updaterPath = Path.Combine(appRoot, "scripts", "apply-windows-update.ps1");
        if (!File.Exists(updaterPath))
        {
            throw new FileNotFoundException("업데이트 도구가 없습니다.", updaterPath);
        }
        ProcessStartInfo info = new ProcessStartInfo();
        info.FileName = "powershell.exe";
        info.Arguments =
            "-NoProfile -ExecutionPolicy Bypass -File " + Quote(updaterPath) +
            " -LauncherPid " + Process.GetCurrentProcess().Id +
            " -ArchivePath " + Quote(archivePath) +
            " -AppRoot " + Quote(appRoot);
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        Process.Start(info);
    }

    private static void CopyDirectory(string sourceDir, string targetDir)
    {
        Directory.CreateDirectory(targetDir);
        foreach (string file in Directory.GetFiles(sourceDir))
        {
            File.Copy(file, Path.Combine(targetDir, Path.GetFileName(file)), true);
        }
        foreach (string directory in Directory.GetDirectories(sourceDir))
        {
            CopyDirectory(directory, Path.Combine(targetDir, Path.GetFileName(directory)));
        }
    }

    private sealed class ReleaseInfo
    {
        public readonly string Version;
        public readonly string DownloadUrl;

        public ReleaseInfo(string version, string downloadUrl)
        {
            Version = version;
            DownloadUrl = downloadUrl;
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
