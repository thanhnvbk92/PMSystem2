"""Independent XLSX checks using openpyxl and actual Calibri font metrics."""
import json
import re
import sys
import warnings
from collections import Counter
from functools import lru_cache
from pathlib import Path

import openpyxl
from PIL import ImageFont


@lru_cache(maxsize=None)
def font(size, bold, italic):
    suffix = "z" if bold and italic else "b" if bold else "i" if italic else ""
    path = Path("C:/Windows/Fonts") / ("calibri" + suffix + ".ttf")
    return ImageFont.truetype(str(path), max(1, round(size * 96 / 72)))


@lru_cache(maxsize=100000)
def text_width(text, face):
    return face.getlength(text)


def wrapped_lines(text, width, face):
    count = 0
    for paragraph in text.replace("\r", "").split("\n"):
        count += 1
        used = 0
        for word in paragraph.split():
            word_width = text_width(word, face)
            space = text_width(" ", face) if used else 0
            if used and used + space + word_width > width:
                count += 1
                used = space = 0
            if word_width > width:
                for char in word:
                    pixels = text_width(char, face)
                    if used and used + pixels > width:
                        count += 1
                        used = 0
                    used += pixels
            else:
                used += space + word_width
    return count


def validate(path, matrix_only=False):
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        book = openpyxl.load_workbook(path)
    assert not caught, [str(item.message) for item in caught]
    assert book.sheetnames == ["Dashboard", "CPK_Overview", "Summary", "CPK_Channels", "Raw_Data"]
    assert book.active.title == "Dashboard"
    assert len(book.active._charts) == 2
    clipped = []
    checked = 0
    for sheet in book:
        dimensions = list(sheet.column_dimensions.values())

        def column_pixels(column):
            for dimension in dimensions:
                if dimension.min <= column <= dimension.max:
                    return dimension.width * 7 + 5
            return 13 * 7 + 5

        merged = {rg.start_cell.coordinate: rg for rg in sheet.merged_cells.ranges}
        geometry_rows = [] if matrix_only and sheet.title not in ("Dashboard", "CPK_Overview") else sheet
        for row in geometry_rows:
            for cell in row:
                if not isinstance(cell.value, str) or not cell.value:
                    continue
                if sheet.title == "Dashboard" and cell.column > 15:
                    continue  # Hidden chart-source cells are not a display region.
                rg = merged.get(cell.coordinate)
                first_col, last_col = (rg.min_col, rg.max_col) if rg else (cell.column, cell.column)
                first_row, last_row = (rg.min_row, rg.max_row) if rg else (cell.row, cell.row)
                width = sum(column_pixels(col) for col in range(first_col, last_col + 1)) - 20
                height = sum(sheet.row_dimensions[r].height or 22 for r in range(first_row, last_row + 1)) * 96 / 72
                face = font(float(cell.font.sz or 11), bool(cell.font.b), bool(cell.font.i))
                lines = wrapped_lines(cell.value, width, face) if cell.alignment.wrap_text else 1
                required = lines * sum(face.getmetrics()) + 6
                checked += 1
                if required > height + 1 or (not cell.alignment.wrap_text and text_width(cell.value, face) > width):
                    clipped.append({"sheet": sheet.title, "cell": cell.coordinate, "required_px": required,
                                    "height_px": height, "value": cell.value[:80]})
        if sheet.title != "Dashboard":
            header_row = sheet[4] if sheet.title == "CPK_Overview" else sheet[1]
            assert all(isinstance(cell.value, str) and cell.value.isascii() for cell in header_row)
            assert not any(dim.hidden for dim in dimensions), "Data columns must remain visible."
    assert not clipped, json.dumps(clipped[:15], ensure_ascii=True)
    overview = book["CPK_Channels"]
    raw = book["Raw_Data"]
    assert [cell.value for cell in overview[1]][:6] == ["Line", "Station", "Channel", "CPK", "Status", "Sample Count"]
    assert [cell.value for cell in raw[1]][:6] == ["Line", "Station", "Channel", "PID", "Inspect Time (ISO 8601)", "Value"]
    assert overview.freeze_panes == raw.freeze_panes == "D2"
    assert raw["F2"].number_format == "General"
    records = [dict(zip((cell.value for cell in overview[1]), row))
               for row in overview.iter_rows(min_row=2, values_only=True)]
    points = [dict(zip((cell.value for cell in raw[1]), row))
              for row in raw.iter_rows(min_row=2, values_only=True)]
    index = {record["Channel ID"]: record for record in records}
    count = Counter(point["Channel ID"] for point in points)
    assert all(count[record["Channel ID"]] == record["Raw Rows"] for record in records)
    assert sum(record["Raw Rows"] for record in records) == len(points)
    for point in points:
        record = index[point["Channel ID"]]
        for field in ["Line", "Station", "Channel", "Job File", "Step Number", "Step Name", "Data From", "Calculated At", "Historical Data"]:
            assert point[field] == record[field], field
        assert point["CPK"] == (None if record["CPK"] == "N/A" else record["CPK"])
    dashboard = book["Dashboard"]
    assert dashboard["A6"].value == len(records)
    assert dashboard["E6"].value == sum(isinstance(row["CPK"], (int, float)) for row in records)
    assert dashboard["M6"].value == sum(row["CPK"] == "N/A" for row in records)
    assert sum(point.v for point in dashboard._charts[0].ser[0].val.numRef.numCache.pt) == len(records)
    assert sum(point.v for series in dashboard._charts[1].ser for point in series.val.numRef.numCache.pt) == len(records)
    matrix = book["CPK_Overview"]
    assert matrix.freeze_panes == "B6"
    assert matrix.print_title_rows == "$1:$5" and matrix.print_title_cols == "$A:$A"
    summary = book["Summary"]
    station_records = [dict(zip((cell.value for cell in summary[1]), row))
                       for row in summary.iter_rows(min_row=2, values_only=True)]
    stations = {record["Station ID"]: record for record in station_records}
    channel_rows = {record["Channel ID"]: row for row, record in enumerate(records, 2)}
    matrix_channels = set()
    matrix_stations = set()
    band = None
    for row in matrix.iter_rows(min_row=6):
        first = row[0].value or ""
        station_match = re.search(r"\nStation ID: (\d+) \| (\d+) machines$", first)
        if not station_match:
            if " stations  |  " in first:
                band = first
            continue
        station_id, machine_count = map(int, station_match.groups())
        assert station_id in stations and station_id not in matrix_stations
        matrix_stations.add(station_id)
        station = stations[station_id]
        assert first.startswith(station["Station"] + "\n")
        assert band and band.startswith(station["Line"] + "  |  ")
        assert machine_count == station["Channels"]
        tiles = [cell for cell in row[1:] if isinstance(cell.value, str) and "\nCPK: " in cell.value]
        assert len(tiles) == machine_count
        for cell in tiles:
            heading, marker, tail = cell.value.rpartition("\nCPK: ")
            match = re.search(r" \[#(\d+)\]$", heading)
            assert marker and match
            channel_id = int(match.group(1))
            assert channel_id in index and channel_id not in matrix_channels
            matrix_channels.add(channel_id)
            record = index[channel_id]
            assert record["Station ID"] == station_id
            assert heading[:match.start()] == record["Channel"]
            cpk = tail.splitlines()[0]
            if record["CPK"] == "N/A":
                assert cpk == "N/A"
                expected_fill = "FFF1F5F9"
            else:
                assert abs(float(cpk) - record["CPK"]) <= 0.000501
                expected_fill = "FFDCFCE7" if record["CPK"] >= 1.33 else "FFFEF3C7" if record["CPK"] >= 1 else "FFFFE4E6"
            assert cell.fill.fgColor.rgb == expected_fill
            assert f'{record["Sample Count"]}/50 samples' in tail
            assert cell.hyperlink.location == f"'CPK_Channels'!C{channel_rows[channel_id]}"
    assert matrix_channels == set(index), "Every channel must appear once in the matrix."
    assert matrix_stations == set(stations), "Empty stations must remain in the matrix."
    print(json.dumps({"file": str(path), "validation": "PASS", "text_cells_checked": checked,
                      "clipped_cells": len(clipped), "channels": len(records), "raw_rows": len(points),
                      "charts": 2, "headers": "English", "source_values": "MATCH",
                      "matrix_stations": len(matrix_stations), "matrix_channels": len(matrix_channels)}))


for filename in (argument for argument in sys.argv[1:] if argument != "--matrix-only"):
    validate(Path(filename), matrix_only="--matrix-only" in sys.argv)
