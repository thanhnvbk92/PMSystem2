using Microsoft.AspNetCore.Mvc;
using PMSystem2.Api.Models;
using PMSystem2.Api.Services;

namespace PMSystem2.Api.Controllers;

[ApiController]
[Route("api/v1/invalid-pcb-results")]
[Route("api/invalid-pcb-results")]
public class InvalidPcbResultsController : ControllerBase
{
    private readonly IInvalidPcbResultService _service;
    public InvalidPcbResultsController(IInvalidPcbResultService service) => _service = service;

    [HttpGet]
    public Task<InvalidPcbResultPage> Get([FromQuery] string? status = "OPEN", [FromQuery] string? search = null,
        [FromQuery] string? rawResult = null, [FromQuery] int page = 1, [FromQuery] int pageSize = 50) =>
        _service.GetPageAsync(status, search, rawResult, page, pageSize);

    [HttpPatch("{id:long}/resolve")]
    public async Task<IActionResult> Resolve(long id, [FromBody] ResolveInvalidPcbRequest request) =>
        await _service.ResolveAsync(id, request.Note) ? NoContent() : NotFound();
}
