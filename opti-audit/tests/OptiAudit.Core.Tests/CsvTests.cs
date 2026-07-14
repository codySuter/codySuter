using OptiAudit.Core.Csv;

namespace OptiAudit.Core.Tests;

public class CsvTests
{
    [Fact]
    public void Parses_simple_rows()
    {
        var rows = CsvFile.ParseText("a,b,c\n1,2,3\n");
        Assert.Equal(2, rows.Count);
        Assert.Equal(new[] { "a", "b", "c" }, rows[0]);
        Assert.Equal(new[] { "1", "2", "3" }, rows[1]);
    }

    [Fact]
    public void Handles_crlf_cr_and_lf_line_endings()
    {
        var rows = CsvFile.ParseText("a,b\r\nc,d\re,f\ng,h");
        Assert.Equal(4, rows.Count);
        Assert.Equal(new[] { "g", "h" }, rows[3]);
    }

    [Fact]
    public void Strips_utf8_bom()
    {
        var rows = CsvFile.ParseText("﻿SKU,Loc 1\n100,54");
        Assert.Equal("SKU", rows[0][0]);
    }

    [Fact]
    public void Quoted_fields_keep_commas_quotes_and_newlines()
    {
        var rows = CsvFile.ParseText("\"a,b\",\"say \"\"hi\"\"\",\"line1\r\nline2\"\nnext,row,here");
        Assert.Equal(2, rows.Count);
        Assert.Equal("a,b", rows[0][0]);
        Assert.Equal("say \"hi\"", rows[0][1]);
        Assert.Equal("line1\r\nline2", rows[0][2]);
        Assert.Equal("next", rows[1][0]);
    }

    [Fact]
    public void Empty_fields_and_trailing_commas_are_preserved()
    {
        var rows = CsvFile.ParseText("a,,c\n,,\nx,y,");
        Assert.Equal(new[] { "a", "", "c" }, rows[0]);
        Assert.Equal(new[] { "", "", "" }, rows[1]);
        Assert.Equal(new[] { "x", "y", "" }, rows[2]);
    }

    [Fact]
    public void Blank_lines_are_skipped()
    {
        var rows = CsvFile.ParseText("a,b\n\n\nc,d\n\n");
        Assert.Equal(2, rows.Count);
    }

    [Fact]
    public void Quoted_empty_string_still_counts_as_a_record()
    {
        var rows = CsvFile.ParseText("\"\"\na,b");
        Assert.Equal(2, rows.Count);
        Assert.Equal(new[] { "" }, rows[0]);
    }

    [Fact]
    public void Missing_trailing_newline_is_fine()
    {
        var rows = CsvFile.ParseText("a,b\nc,d");
        Assert.Equal(2, rows.Count);
    }

    [Fact]
    public void Write_escapes_commas_quotes_newlines_and_edge_spaces()
    {
        var text = CsvFile.Write(new[]
        {
            new[] { "plain", "a,b", "say \"hi\"", "line1\nline2", " padded " },
        });
        Assert.Equal("plain,\"a,b\",\"say \"\"hi\"\"\",\"line1\nline2\",\" padded \"\r\n", text);
    }

    [Fact]
    public void Write_then_parse_round_trips()
    {
        var original = new List<string[]>
        {
            new[] { "SKU", "Loc 1", "Desc" },
            new[] { "1001", "54", "WIDGET, LARGE \"XL\"" },
            new[] { "1002", "", "multi\r\nline" },
        };
        var parsed = CsvFile.ParseText(CsvFile.Write(original.Select(r => (IReadOnlyList<string>)r)));
        Assert.Equal(original.Count, parsed.Count);
        for (int i = 0; i < original.Count; i++)
            Assert.Equal(original[i], parsed[i]);
    }

    [Fact]
    public void Question_mark_cells_survive_round_trip_exactly()
    {
        var parsed = CsvFile.ParseText(CsvFile.Write(new[] { new[] { "1001", "?", "", "?" } }));
        Assert.Equal(new[] { "1001", "?", "", "?" }, parsed[0]);
    }

    [Fact]
    public void Unterminated_quoted_field_throws_instead_of_swallowing_the_rest_of_the_file()
    {
        var ex = Assert.Throws<FormatException>(() => CsvFile.ParseText("a,b\n\"truncated,oops\nc,d"));
        Assert.Contains("truncated or corrupt", ex.Message);
    }

    [Fact]
    public void ParseFile_reads_utf8_with_and_without_bom()
    {
        var path = Path.Combine(Path.GetTempPath(), $"optiaudit-utf8-{Guid.NewGuid():N}.csv");
        try
        {
            File.WriteAllBytes(path, new byte[] { 0xEF, 0xBB, 0xBF }
                .Concat(System.Text.Encoding.UTF8.GetBytes("SKU,Desc\n1001,CAFÉ")).ToArray());
            var rows = CsvFile.ParseFile(path);
            Assert.Equal("SKU", rows[0][0]);
            Assert.Equal("CAFÉ", rows[1][1]);
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public void ParseFile_falls_back_to_latin1_for_ansi_exports()
    {
        var path = Path.Combine(Path.GetTempPath(), $"optiaudit-ansi-{Guid.NewGuid():N}.csv");
        try
        {
            File.WriteAllBytes(path, System.Text.Encoding.Latin1.GetBytes("SKU,Desc\n1001,CAFÉ 90°"));
            var rows = CsvFile.ParseFile(path);
            Assert.Equal("CAFÉ 90°", rows[1][1]); // not U+FFFD replacement chars
        }
        finally { File.Delete(path); }
    }
}
