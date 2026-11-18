using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;

namespace PMSystem2.Api.Controllers;

/// <summary>
/// Meeting reports (NTF / Re-test / FPY decks, ...) saved as files in the reports folder.
/// The folder is "Reports" next to the backend folder unless Reports:Directory is configured.
/// </summary>
[ApiController]
[Route("api/v1/reports")]
[Route("api/reports")]
public class ReportsController : ControllerBase
{
    private static readonly string[] AllowedExtensions = { ".pptx", ".pdf", ".xlsx", ".docx", ".html" };
    private static readonly FileExtensionContentTypeProvider ContentTypes = new();
    private readonly string _directory;

    public ReportsController(IConfiguration configuration, IWebHostEnvironment environment)
    {
        var configured = configuration["Reports:Directory"];
        _directory = Path.GetFullPath(string.IsNullOrWhiteSpace(configured)
            ? Path.Combine(environment.ContentRootPath, "..", "Reports")
            : configured);
    }

    public record ReportFileDto(string Name, long SizeBytes, DateTime ModifiedAt, string Extension);

    [HttpGet]
    public ActionResult<List<ReportFileDto>> List()
    {
        if (!Directory.Exists(_directory)) return Ok(new List<ReportFileDto>());
        var files = new DirectoryInfo(_directory).EnumerateFiles()
            .Where(f => AllowedExtensions.Contains(f.Extension, StringComparer.OrdinalIgnoreCase)
                        && !f.Name.StartsWith("~$", StringComparison.Ordinal)) // Office lock files
            .OrderByDescending(f => f.LastWriteTimeUtc)
            .Select(f => new ReportFileDto(f.Name, f.Length, f.LastWriteTimeUtc, f.Extension.ToLowerInvariant()))
            .ToList();
        return Ok(files);
    }

    /// <summary>
    /// Aggregated data for the periodic NTF / Re-test / FPY reports, read from the rollup and summary
    /// tables (seconds instead of scanning pcb_results). Dates are factory-clock days; endDate is exclusive.
    /// period = day | week | month.
    /// </summary>
    [HttpGet("quality-data")]
    public async Task<IActionResult> QualityData([FromServices] PMSystem2.Api.Services.QualityReportDataService service,
        [FromQuery] DateOnly startDate, [FromQuery] DateOnly endDate, [FromQuery] string period = "month",
        CancellationToken cancellationToken = default)
    {
        if (endDate <= startDate) return BadRequest("endDate must be after startDate.");
        if (endDate.DayNumber - startDate.DayNumber > 800) return BadRequest("Range is limited to 800 days.");
        return Ok(await service.GetAsync(startDate, endDate, period, cancellationToken));
    }

    /// <summary>Starts generating the monthly report for month (YYYY-MM) in the background.</summary>
    [HttpPost("generate")]
    public IActionResult Generate([FromServices] PMSystem2.Api.Services.ReportGenerationService generator, [FromQuery] string month)
    {
        if (generator.TryStart(month, out var problem)) return Accepted(generator.GetStatus());
        return problem != null && problem.StartsWith("A report") ? Conflict(new { error = problem, status = generator.GetStatus() })
                                                                 : BadRequest(new { error = problem });
    }

    /// <summary>State of the current / last report generation (idle, running, succeeded, failed).</summary>
    [HttpGet("generate/status")]
    public IActionResult GenerateStatus([FromServices] PMSystem2.Api.Services.ReportGenerationService generator)
        => Ok(generator.GetStatus());

    /// <summary>Returns one report. download=false opens it in the browser when the browser can show it (PDF, HTML).</summary>
    [HttpGet("{fileName}")]
    public IActionResult Get(string fileName, [FromQuery] bool download = true)
    {
        // Only a bare file name from the reports folder, never a path.
        if (string.IsNullOrWhiteSpace(fileName) || fileName != Path.GetFileName(fileName))
            return BadRequest("Invalid file name.");
        var fullPath = Path.GetFullPath(Path.Combine(_directory, fileName));
        if (!fullPath.StartsWith(_directory + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)
            || !AllowedExtensions.Contains(Path.GetExtension(fullPath), StringComparer.OrdinalIgnoreCase)
            || !System.IO.File.Exists(fullPath))
            return NotFound();

        if (!ContentTypes.TryGetContentType(fullPath, out var contentType))
            contentType = "application/octet-stream";
        return download
            ? PhysicalFile(fullPath, contentType, fileName)
            : PhysicalFile(fullPath, contentType);
    }
}
