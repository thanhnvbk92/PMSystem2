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
