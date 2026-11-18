using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;

namespace PMSystem2.Api.Services;

/// <summary>
/// Runs scripts/quality_report/generate.py in the background to produce the monthly report.
/// One job at a time (the report reads large statistics tables). State is kept in memory.
/// Settings: Reports:Python (default "python"), Reports:ScriptsDirectory, Reports:Directory.
/// </summary>
public sealed class ReportGenerationService
{
    public record JobStatus(string Status, string? Month, DateTime? StartedAt, DateTime? FinishedAt,
        string? Step, string? FileName, string? Error, IReadOnlyList<string> Log);

    private readonly object _gate = new();
    private readonly ILogger<ReportGenerationService> _logger;
    private readonly string _python, _scriptsDir, _reportsDir;
    private readonly string? _connectionString;
    private readonly List<string> _log = new();
    private string _status = "idle";
    private string? _month, _step, _file, _error, _lastStderr;
    private DateTime? _started, _finished;

    public ReportGenerationService(IConfiguration configuration, IWebHostEnvironment environment, ILogger<ReportGenerationService> logger)
    {
        _logger = logger;
        _python = configuration["Reports:Python"] ?? "python";
        _scriptsDir = Path.GetFullPath(configuration["Reports:ScriptsDirectory"]
            ?? Path.Combine(environment.ContentRootPath, "..", "scripts", "quality_report"));
        _reportsDir = Path.GetFullPath(string.IsNullOrWhiteSpace(configuration["Reports:Directory"])
            ? Path.Combine(environment.ContentRootPath, "..", "Reports")
            : configuration["Reports:Directory"]!);
        _connectionString = configuration.GetConnectionString("DefaultConnection");
    }

    public JobStatus GetStatus()
    {
        lock (_gate) return new JobStatus(_status, _month, _started, _finished, _step, _file, _error, _log.TakeLast(30).ToList());
    }

    /// <summary>Starts a job for month (YYYY-MM). Returns false when a job is already running.</summary>
    public bool TryStart(string month, out string? problem)
    {
        problem = null;
        if (!Regex.IsMatch(month, @"^\d{4}-(0[1-9]|1[0-2])$")) { problem = "month must be YYYY-MM"; return false; }
        var script = Path.Combine(_scriptsDir, "generate.py");
        if (!File.Exists(script)) { problem = $"generate.py not found in {_scriptsDir}"; return false; }
        lock (_gate)
        {
            if (_status == "running") { problem = $"A report for {_month} is already being generated."; return false; }
            _status = "running"; _month = month; _started = DateTime.Now; _finished = null;
            _step = "Starting"; _file = null; _error = null; _lastStderr = null; _log.Clear();
        }
        _ = Task.Run(() => RunAsync(script, month));
        return true;
    }

    private async Task RunAsync(string script, string month)
    {
        try
        {
            var psi = new ProcessStartInfo(_python)
            {
                WorkingDirectory = _scriptsDir,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            psi.ArgumentList.Add("-I");
            psi.ArgumentList.Add(script);
            psi.ArgumentList.Add("--month"); psi.ArgumentList.Add(month);
            psi.ArgumentList.Add("--out-dir"); psi.ArgumentList.Add(_reportsDir);
            psi.Environment["PYTHONIOENCODING"] = "utf-8";
            if (!string.IsNullOrEmpty(_connectionString)) psi.Environment["PMS_CONNECTION"] = _connectionString;

            using var process = Process.Start(psi) ?? throw new InvalidOperationException($"Could not start {_python}");
            process.OutputDataReceived += (_, e) => { if (e.Data != null) Append(e.Data); };
            process.ErrorDataReceived += (_, e) => { if (e.Data != null) Append(e.Data, isError: true); };
            process.BeginOutputReadLine(); process.BeginErrorReadLine();
            using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(30));
            try { await process.WaitForExitAsync(timeout.Token); }
            catch (OperationCanceledException) { process.Kill(entireProcessTree: true); throw new TimeoutException("Report generation took longer than 30 minutes."); }

            lock (_gate)
            {
                _finished = DateTime.Now;
                if (process.ExitCode == 0 && _file != null) { _status = "succeeded"; _step = "Done"; }
                else { _status = "failed"; _error = _lastStderr ?? $"generate.py exited with code {process.ExitCode}"; }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Report generation for {Month} failed.", month);
            lock (_gate) { _status = "failed"; _finished = DateTime.Now; _error = ex.Message; }
        }
    }

    private void Append(string line, bool isError = false)
    {
        lock (_gate)
        {
            _log.Add(line);
            if (_log.Count > 200) _log.RemoveAt(0);
            if (line.StartsWith("STEP ", StringComparison.Ordinal)) _step = line[5..];
            else if (line.StartsWith("DONE ", StringComparison.Ordinal)) _file = line[5..].Split(" in ")[0];
            else if (isError && !string.IsNullOrWhiteSpace(line)) _lastStderr = line.Trim();
        }
    }
}
