using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

internal static class ChungbukInventoryLauncher
{
    private const string AppUrl = "http://127.0.0.1:5177/";
    private const string LatestReleaseUrl = "https://api.github.com/repos/pyb0987/chungbuk-inventory-app/releases/latest";
    private static Process appProcess;
    private static Button openButton;
    private static Button stopButton;
    private static Label statusLabel;
    private static System.Windows.Forms.Timer processTimer;
    private static Mutex instanceMutex;

    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;

        string appRoot = AppDomain.CurrentDomain.BaseDirectory;
        string[] commandLine = Environment.GetCommandLineArgs();
        if (commandLine.Length > 1 && commandLine[1] == "--smoke-test")
        {
            Environment.Exit(RunPackagedStartupSmokeTest(appRoot) ? 0 : 1);
        }
        if (commandLine.Length > 1 && commandLine[1] == "--health-check")
        {
            string expected = commandLine.Length > 2 ? commandLine[2] : "";
            Environment.Exit(ValidatePackageRoot(appRoot, expected) ? 0 : 1);
        }
        if (commandLine.Length > 3 && commandLine[1] == "--restart-marker")
        {
            File.WriteAllText(commandLine[2], commandLine[3], Encoding.ASCII);
            Environment.Exit(0);
        }
        if (commandLine.Length > 3 && commandLine[1] == "--restart-readiness-test")
        {
            bool ready = RunPackagedStartupSmokeTest(appRoot);
            File.WriteAllText(
                commandLine[2],
                ready ? commandLine[3] : "not-ready",
                Encoding.ASCII);
            Environment.Exit(ready ? 0 : 1);
        }
        if (commandLine.Length > 3 && commandLine[1] == "--shared-migration-test")
        {
            string testSourceDir = commandLine[2];
            string testSharedDir = commandLine[3];
            try
            {
                MigrateToSharedUserData(
                    Path.Combine(appRoot, "runtime", "node", "node.exe"),
                    appRoot,
                    testSharedDir,
                    testSourceDir,
                    false);
                Environment.Exit(0);
            }
            catch (InvalidOperationException)
            {
                Environment.Exit(2);
            }
            catch
            {
                Environment.Exit(1);
            }
        }
        if (commandLine.Length > 4 && commandLine[1] == "--updater-launch-test")
        {
            string testArchive = commandLine[2];
            string testVersion = commandLine[3];
            string testDataDir = commandLine[4];
            string testRestartMarker = commandLine.Length > 5 ? commandLine[5] : null;
            try
            {
                StartUpdater(
                    appRoot,
                    testDataDir,
                    testArchive,
                    testVersion,
                    String.IsNullOrEmpty(testRestartMarker),
                    testRestartMarker,
                    !String.IsNullOrEmpty(testRestartMarker));
                Environment.Exit(0);
            }
            catch (Exception error)
            {
                try
                {
                    Directory.CreateDirectory(testDataDir);
                    File.WriteAllText(
                        Path.Combine(testDataDir, "updater-launch-error.log"),
                        error.ToString());
                }
                catch
                {
                    // Preserve the original updater-launch failure exit code.
                }
                Environment.Exit(1);
            }
        }
        bool createdNew;
        MutexSecurity mutexSecurity = new MutexSecurity();
        mutexSecurity.AddAccessRule(
            new MutexAccessRule(
                new SecurityIdentifier(WellKnownSidType.WorldSid, null),
                MutexRights.FullControl,
                AccessControlType.Allow));
        instanceMutex = new Mutex(
            true,
            "Global\\ChungbukInventoryLauncher",
            out createdNew,
            mutexSecurity);
        if (!createdNew)
        {
            MessageBox.Show("충북 재고관리 앱이 이미 실행 중입니다.", "충북 재고관리");
            return;
        }
        string nodePath = Path.Combine(appRoot, "runtime", "node", "node.exe");
        string scriptPath = Path.Combine(appRoot, "scripts", "start-portable.mjs");
        string localDataDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "ChungbukInventory");
        string dataDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonDocuments),
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
            MigrateToSharedUserData(nodePath, appRoot, dataDir, localDataDir, true);
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
            processTimer = new System.Windows.Forms.Timer();
            processTimer.Interval = 1000;
            processTimer.Tick += delegate { UpdateProcessStatus(); };
            processTimer.Start();

            form.FormClosing += delegate { StopApp(); };
            Application.Run(form);
        }
    }

    private static bool RunPackagedStartupSmokeTest(string appRoot)
    {
        string nodePath = Path.Combine(appRoot, "runtime", "node", "node.exe");
        string scriptPath = Path.Combine(appRoot, "scripts", "start-portable.mjs");
        string dataDir = Path.Combine(
            Path.GetTempPath(),
            "ChungbukInventory-smoke-" + Guid.NewGuid().ToString("N"));
        try
        {
            Directory.CreateDirectory(dataDir);
            StartApp(nodePath, scriptPath, appRoot, dataDir, false);
            for (int attempt = 0; attempt < 60; attempt++)
            {
                if (appProcess == null || appProcess.HasExited)
                {
                    return false;
                }
                try
                {
                    HttpWebRequest request = (HttpWebRequest)WebRequest.Create(AppUrl + "api/state");
                    request.Timeout = 1000;
                    using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                    using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                    {
                        string body = reader.ReadToEnd();
                        if (response.StatusCode == HttpStatusCode.OK &&
                            body.Contains("\"dashboard\"") &&
                            body.Contains("\"items\""))
                        {
                            return true;
                        }
                    }
                }
                catch (WebException)
                {
                    // The packaged server may still be starting.
                }
                Thread.Sleep(500);
            }
            return false;
        }
        finally
        {
            StopApp();
            try
            {
                Directory.Delete(dataDir, true);
            }
            catch
            {
                // The smoke test result is determined by startup readiness.
            }
        }
    }

    private static void MigrateToSharedUserData(
        string nodePath,
        string appRoot,
        string sharedDataDir,
        string localDataDir,
        bool showNotifications)
    {
        string legacyDir = Path.Combine(appRoot, "user-data");
        string targetDatabase = Path.Combine(sharedDataDir, "chungbuk-inventory.sqlite");
        string localDatabase = Path.Combine(localDataDir, "chungbuk-inventory.sqlite");
        string legacyDatabase = Path.Combine(legacyDir, "chungbuk-inventory.sqlite");
        string sourceDatabase = File.Exists(localDatabase) ? localDatabase : legacyDatabase;
        string sourceMarker = Path.Combine(
            Path.GetDirectoryName(sourceDatabase),
            ".migrated-to-shared-data");

        Directory.CreateDirectory(sharedDataDir);
        if (File.Exists(targetDatabase))
        {
            if (RunDatabaseValidation(nodePath, appRoot, targetDatabase))
            {
                if (File.Exists(sourceDatabase) && !File.Exists(sourceMarker))
                {
                    throw new InvalidOperationException(
                        "공용 데이터베이스와 현재 Windows 계정의 기존 데이터베이스가 모두 발견되었습니다.\n\n" +
                        "공용: " + targetDatabase + "\n" +
                        "현재 계정: " + sourceDatabase + "\n\n" +
                        "두 파일을 모두 백업한 뒤 사용할 데이터베이스를 선택해 주세요.");
                }
                return;
            }
            if (!File.Exists(sourceDatabase) ||
                !RunDatabaseValidation(nodePath, appRoot, sourceDatabase))
            {
                throw new InvalidDataException(
                    "공용 데이터베이스가 손상되었고 복구 가능한 기존 데이터베이스도 없습니다: " +
                    targetDatabase);
            }
            string quarantined = targetDatabase + ".invalid-" + DateTime.Now.ToString("yyyyMMdd-HHmmss");
            File.Move(targetDatabase, quarantined);
        }
        if (File.Exists(sourceDatabase))
        {
            if (!RunDatabaseValidation(nodePath, appRoot, sourceDatabase))
            {
                throw new InvalidDataException(
                    "기존 데이터베이스를 확인할 수 없습니다: " + sourceDatabase);
            }
            RunDatabaseCopy(nodePath, appRoot, "migrate", sourceDatabase, targetDatabase);
            File.WriteAllText(
                sourceMarker,
                "Migrated to " + targetDatabase + Environment.NewLine +
                DateTime.Now.ToString("O"),
                Encoding.UTF8);
            if (showNotifications)
            {
                MessageBox.Show(
                    "기존 재고 데이터를 두 Windows 계정이 함께 사용하는 공용 폴더로 안전하게 복사했습니다.\n\n" +
                    sharedDataDir,
                    "충북 재고관리",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            }
        }
    }

    private static bool RunDatabaseValidation(
        string nodePath,
        string appRoot,
        string databasePath)
    {
        string helper = Path.Combine(appRoot, "scripts", "safe-database-copy.mjs");
        ProcessStartInfo info = new ProcessStartInfo();
        info.FileName = nodePath;
        info.Arguments = Quote(helper) + " validate " + Quote(databasePath);
        info.WorkingDirectory = appRoot;
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        using (Process process = Process.Start(info))
        {
            process.WaitForExit();
            return process.ExitCode == 0;
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

            BackupDatabaseBeforeUpdate(
                Path.Combine(appRoot, "runtime", "node", "node.exe"),
                appRoot,
                dataDir,
                currentVersionText);
            string archivePath = Path.Combine(
                Path.GetTempPath(),
                "ChungbukInventory-" + release.Version + "-" + Guid.NewGuid().ToString("N") + ".zip");
            DownloadFile(release.DownloadUrl, archivePath);
            if (!String.Equals(ComputeSha256(archivePath), release.Sha256, StringComparison.OrdinalIgnoreCase))
            {
                File.Delete(archivePath);
                throw new InvalidDataException("업데이트 파일의 SHA-256 검증에 실패했습니다.");
            }
            StartUpdater(appRoot, dataDir, archivePath, release.Version);
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
        Match immutable = Regex.Match(json, "\"immutable\"\\s*:\\s*true", RegexOptions.IgnoreCase);
        Match asset = Regex.Match(
            json,
            "\"browser_download_url\"\\s*:\\s*\"([^\"]*chungbuk-inventory-portable-release\\.zip)\"",
            RegexOptions.IgnoreCase);
        Match manifestAsset = Regex.Match(
            json,
            "\"browser_download_url\"\\s*:\\s*\"([^\"]*release-manifest\\.json)\"",
            RegexOptions.IgnoreCase);
        if (!tag.Success || !immutable.Success || !asset.Success || !manifestAsset.Success)
        {
            return null;
        }
        string version = tag.Groups[1].Value;
        string downloadUrl = asset.Groups[1].Value.Replace("\\/", "/");
        string manifestUrl = manifestAsset.Groups[1].Value.Replace("\\/", "/");
        ValidateReleaseUrl(downloadUrl, version);
        ValidateReleaseUrl(manifestUrl, version);
        string manifest = DownloadText(manifestUrl);
        Match manifestVersion = Regex.Match(manifest, "\"version\"\\s*:\\s*\"([^\"]+)\"");
        Match sha256 = Regex.Match(manifest, "\"sha256\"\\s*:\\s*\"([a-fA-F0-9]{64})\"");
        if (!manifestVersion.Success || !sha256.Success || manifestVersion.Groups[1].Value != version)
        {
            throw new InvalidDataException("릴리스 매니페스트가 버전과 일치하지 않습니다.");
        }
        return new ReleaseInfo(version, downloadUrl, sha256.Groups[1].Value.ToLowerInvariant());
    }

    private static bool IsNewerVersion(string candidate, string current)
    {
        Version candidateVersion;
        Version currentVersion;
        return Version.TryParse(candidate, out candidateVersion) &&
            Version.TryParse(current, out currentVersion) &&
            candidateVersion.CompareTo(currentVersion) > 0;
    }

    private static void BackupDatabaseBeforeUpdate(
        string nodePath,
        string appRoot,
        string dataDir,
        string currentVersion)
    {
        string databasePath = Path.Combine(dataDir, "chungbuk-inventory.sqlite");
        if (!File.Exists(databasePath))
        {
            return;
        }
        string backupDir = Path.Combine(dataDir, "backups");
        Directory.CreateDirectory(backupDir);
        string stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
        RunDatabaseCopy(
            nodePath,
            appRoot,
            "backup",
            databasePath,
            Path.Combine(backupDir, "before-update-" + currentVersion + "-" + stamp + ".sqlite"));
    }

    private static void DownloadFile(string url, string targetPath)
    {
        using (WebClient client = new WebClient())
        {
            client.Headers.Add(HttpRequestHeader.UserAgent, "ChungbukInventory");
            client.DownloadFile(url, targetPath);
        }
    }

    private static void StartUpdater(
        string appRoot,
        string dataDir,
        string archivePath,
        string expectedVersion,
        bool noRestart = false,
        string restartMarker = null,
        bool noDialogs = false)
    {
        appRoot = appRoot.TrimEnd(
            Path.DirectorySeparatorChar,
            Path.AltDirectorySeparatorChar);
        string updaterPath = Path.Combine(appRoot, "scripts", "apply-windows-update.ps1");
        if (!File.Exists(updaterPath))
        {
            throw new FileNotFoundException("업데이트 도구가 없습니다.", updaterPath);
        }
        string updaterCopy = Path.Combine(
            Path.GetTempPath(),
            "ChungbukInventory-updater-" + Guid.NewGuid().ToString("N") + ".ps1");
        File.Copy(updaterPath, updaterCopy, false);
        string logDir = Path.Combine(dataDir, "logs");
        Directory.CreateDirectory(logDir);
        string logPath = Path.Combine(
            logDir,
            "update-" + DateTime.Now.ToString("yyyy-MM-dd") + ".log");
        string safeWorkingDirectory = Directory.GetParent(
            appRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)).FullName;

        ProcessStartInfo info = new ProcessStartInfo();
        info.FileName = "powershell.exe";
        info.Arguments =
            "-NoProfile -ExecutionPolicy Bypass -File " + Quote(updaterCopy) +
            " -LauncherPid " + Process.GetCurrentProcess().Id +
            " -ArchivePath " + Quote(archivePath) +
            " -AppRoot " + Quote(appRoot) +
            " -ExpectedVersion " + Quote(expectedVersion) +
            " -LogPath " + Quote(logPath) +
            (String.IsNullOrEmpty(restartMarker) ? "" : " -RestartMarker " + Quote(restartMarker)) +
            (noDialogs ? " -NoDialogs" : "") +
            (noRestart ? " -NoRestart" : "");
        info.WorkingDirectory = safeWorkingDirectory;
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        try
        {
            Process.Start(info);
        }
        catch
        {
            File.Delete(updaterCopy);
            throw;
        }
    }

    private static void RunDatabaseCopy(
        string nodePath,
        string appRoot,
        string operation,
        string source,
        string target)
    {
        string helper = Path.Combine(appRoot, "scripts", "safe-database-copy.mjs");
        ProcessStartInfo info = new ProcessStartInfo();
        info.FileName = nodePath;
        info.Arguments = Quote(helper) + " " + operation + " " + Quote(source) + " " + Quote(target);
        info.WorkingDirectory = appRoot;
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        using (Process process = Process.Start(info))
        {
            process.WaitForExit();
            if (process.ExitCode != 0 && !(operation == "migrate" && process.ExitCode == 3))
            {
                throw new InvalidOperationException("안전한 데이터베이스 복사에 실패했습니다.");
            }
        }
    }

    private static string DownloadText(string url)
    {
        using (WebClient client = new WebClient())
        {
            client.Headers.Add(HttpRequestHeader.UserAgent, "ChungbukInventory");
            return client.DownloadString(url);
        }
    }

    private static void ValidateReleaseUrl(string url, string version)
    {
        Uri uri;
        string expectedPrefix = "/pyb0987/chungbuk-inventory-app/releases/download/v" + version + "/";
        if (!Uri.TryCreate(url, UriKind.Absolute, out uri) ||
            uri.Scheme != Uri.UriSchemeHttps ||
            !String.Equals(uri.Host, "github.com", StringComparison.OrdinalIgnoreCase) ||
            !uri.AbsolutePath.StartsWith(expectedPrefix, StringComparison.Ordinal))
        {
            throw new InvalidDataException("허용되지 않은 업데이트 주소입니다.");
        }
    }

    private static string ComputeSha256(string path)
    {
        using (SHA256 hash = SHA256.Create())
        using (FileStream stream = File.OpenRead(path))
        {
            return BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
        }
    }

    private static bool ValidatePackageRoot(string root, string expectedVersion)
    {
        bool filesValid = !String.IsNullOrEmpty(expectedVersion) &&
            File.Exists(Path.Combine(root, "ChungbukInventory.exe")) &&
            File.Exists(Path.Combine(root, "runtime", "node", "node.exe")) &&
            File.Exists(Path.Combine(root, "scripts", "start-portable.mjs")) &&
            File.Exists(Path.Combine(root, "scripts", "apply-windows-update.ps1")) &&
            ReadCurrentVersion(root) == expectedVersion;
        if (!filesValid)
        {
            return false;
        }
        ProcessStartInfo info = new ProcessStartInfo();
        info.FileName = Path.Combine(root, "runtime", "node", "node.exe");
        info.Arguments = Quote(Path.Combine(root, "scripts", "health-check-portable.mjs"));
        info.WorkingDirectory = root;
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        using (Process health = Process.Start(info))
        {
            if (!health.WaitForExit(15000))
            {
                health.Kill();
                return false;
            }
            return health.ExitCode == 0;
        }
    }

    private sealed class ReleaseInfo
    {
        public readonly string Version;
        public readonly string DownloadUrl;
        public readonly string Sha256;

        public ReleaseInfo(string version, string downloadUrl, string sha256)
        {
            Version = version;
            DownloadUrl = downloadUrl;
            Sha256 = sha256;
        }
    }

    private static void StartApp(
        string nodePath,
        string scriptPath,
        string appRoot,
        string dataDir,
        bool openBrowser = true)
    {
        ProcessStartInfo info = new ProcessStartInfo();
        info.FileName = nodePath;
        info.Arguments = Quote(scriptPath);
        info.WorkingDirectory = appRoot;
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.WindowStyle = ProcessWindowStyle.Hidden;
        info.EnvironmentVariables["CHUNGBUK_DATA_DIR"] = dataDir;
        if (!openBrowser)
        {
            info.EnvironmentVariables["CHUNGBUK_NO_BROWSER"] = "1";
        }

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
        if (String.IsNullOrEmpty(value))
        {
            return "\"\"";
        }

        StringBuilder quoted = new StringBuilder();
        quoted.Append('"');
        int backslashes = 0;
        foreach (char character in value)
        {
            if (character == '\\')
            {
                backslashes++;
                continue;
            }
            if (character == '"')
            {
                quoted.Append('\\', backslashes * 2 + 1);
                quoted.Append('"');
                backslashes = 0;
                continue;
            }
            quoted.Append('\\', backslashes);
            backslashes = 0;
            quoted.Append(character);
        }
        quoted.Append('\\', backslashes * 2);
        quoted.Append('"');
        return quoted.ToString();
    }
}
