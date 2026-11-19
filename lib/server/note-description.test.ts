import { describe, expect, it } from "vitest";
import { NOTE_DESCRIPTION_LIMIT } from "../contracts/note-review";
import { plainDescription } from "./note-description";

// Google descriptions as the note review's details show them: plain text only.

describe("plainDescription", () => {
  it("turns Google's HTML into plain lines and drops every tag", () => {
    expect(plainDescription('준비물:<br>신분증<br/>노트북<p>장소: <a href="https://example.test">3층</a></p>')).toBe("준비물:\n신분증\n노트북\n장소: 3층");
    expect(plainDescription("<ul><li>우유</li><li>계란</li></ul>")).toBe("• 우유\n• 계란");
    expect(plainDescription('<img src=x onerror="alert(1)">사진<script>alert(2)</script>')).toBe("사진alert(2)");
  });

  it("decodes entities once, so escaped markup stays text", () => {
    expect(plainDescription("a &amp; b &lt;b&gt;bold&lt;/b&gt; &#39;q&#39; &#x1F600;&nbsp;end")).toBe("a & b <b>bold</b> 'q' 😀 end");
    expect(plainDescription("&#0;&#xD800;bad")).toBe("bad");
  });

  it("returns null for a missing or empty description", () => {
    expect(plainDescription(undefined)).toBeNull();
    expect(plainDescription(null)).toBeNull();
    expect(plainDescription("  <br> <p></p> ")).toBeNull();
  });

  it("keeps plain text as written, with blank runs folded", () => {
    expect(plainDescription("첫 줄\r\n\r\n\r\n\r\n둘째   줄 \n")).toBe("첫 줄\n\n둘째 줄");
  });

  it("cuts a long description at the limit with an ellipsis", () => {
    const cut = plainDescription("가".repeat(NOTE_DESCRIPTION_LIMIT + 50))!;
    expect([...cut]).toHaveLength(NOTE_DESCRIPTION_LIMIT + 1);
    expect(cut.endsWith("…")).toBe(true);
    expect(plainDescription("x".repeat(NOTE_DESCRIPTION_LIMIT))).toBe("x".repeat(NOTE_DESCRIPTION_LIMIT));
  });
});
