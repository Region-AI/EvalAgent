# 🔒 Markdown Injection & XSS Sanitization Test Corpus

**Target stack:** `marked` → `DOMPurify`

---

## 0. Control (must render normally)

**bold** *italic* `code`

[Safe link](https://example.com)

![Safe image](https://www.cameraegg.org/wp-content/uploads/2014/09/Nikon-D750-Sample-Images-3.jpg)

---

## 1. Script Tag Injection (must be removed)

```html
<script>alert("SCRIPT_EXECUTED")</script>
```

Inline:

<script>alert("INLINE_SCRIPT")</script>

Expected: **script tag removed entirely**

---

## 2. Event Handler Attributes (must be stripped)

<img src="https://www.cameraegg.org/wp-content/uploads/2014/09/Nikon-D750-Sample-Images-3.jpg" onload="alert('IMG_ONLOAD')">
<div onclick="alert('DIV_CLICK')">Click me</div>
<a href="https://example.com" onmouseover="alert('HOVER')">Hover</a>

Expected:

* element remains (if allowed)
* **event attributes removed**

---

## 3. JavaScript URL Schemes (must be blocked)

Markdown link:

[JS link](javascript:alert("JS_URL"))

HTML link:

<a href="javascript:alert('JS_URL_HTML')">click</a>

Image source:

<img src="javascript:alert('IMG_JS_URL')">

Expected:

* `href` / `src` removed or rewritten
* no execution

---

## 4. Obfuscated JavaScript Schemes (normalization test)

<a href="java&#x73;cript:alert('ENTITY_SCHEME')">entity</a>

<a href="javascript&#x3A;alert('COLON_ENTITY')">colon entity</a>

<a href="javascript%3Aalert('PERCENT_COLON')">percent encoded</a>

<a href=" j a v a s c r i p t : alert('WHITESPACE') ">spaces</a>

Expected:

* **still blocked after decoding**

---

## 5. Attribute Breakout / Quote Injection

<img src="https://www.cameraegg.org/wp-content/uploads/2014/09/Nikon-D750-Sample-Images-3.jpg" alt="x" title="ok" onerror="alert('BREAKOUT')">

<img src="x" alt="test" title="x' onerror='alert(&quot;QUOTE_BREAK&quot;)'">

Expected:

* no new attributes appear
* no execution

---

## 6. SVG-Based Injection (must be removed)

<svg onload="alert('SVG_ONLOAD')"></svg>

<svg>
  <script>alert("SVG_SCRIPT")</script>
</svg>


Expected:

* entire SVG removed (default DOMPurify behavior)

---

## 7. iframe / embed / object (must be removed)

<iframe src="https://example.com"></iframe>
<object data="https://example.com"></object>
<embed src="https://example.com">

Expected: removed

---

## 8. CSS Injection Surface

<div style="background-image: url(javascript:alert('CSS_URL'))">
CSS test
</div>

<div style="width: expression(alert('CSS_EXPR'))">
CSS expression
</div>

Expected:

* `style` attribute removed or sanitized
* no execution

---

## 9. Data URLs (policy-dependent, usually blocked)

<img src="data:text/html,<script>alert('DATA_URL')</script>">

[Data link](data:text/html,<script>alert('DATA_LINK')</script>)

Expected:

* removed or neutralized

---

## 10. HTML Entity Resurrection

&lt;script&gt;alert("ENTITY_SCRIPT")&lt;/script&gt;

&amp;lt;script&amp;gt;alert("DOUBLE_ENTITY")&amp;lt;/script&amp;gt;

&#x3C;script&#x3E;alert("HEX_ENTITY")&#x3C;/script&#x3E;

Expected:

* rendered as **text**
* never becomes executable HTML

---

## 11. Malformed / Unclosed HTML

<div><span><img src=x onerror=alert("UNCLOSED")

<a href="https://example.com" title="unterminated>
broken

Expected:

* DOM remains safe
* sanitizer does not “fix” into executable form

---

## 12. Markdown Reference Link Injection

[bad][x]

[x]: javascript:alert("REF_LINK")

Expected: reference link blocked

---

## 13. Autolink Injection

<javascript:alert("AUTO_LINK")>

Expected: not clickable / stripped

---

## 14. Inline HTML Inside Markdown Contexts

- Item
  <img src="x" onerror="alert('LIST_CONTEXT')">

> Quote
> <svg onload="alert('QUOTE_CONTEXT')"></svg>

Expected: same sanitization rules apply

---

## 15. Code Blocks Must Never Execute

Inline:

`<img src=x onerror=alert("INLINE_CODE")>`

Block:

<img src="x" onerror="alert('CODE_BLOCK')">
<script>alert("CODE_BLOCK_SCRIPT")</script>

Expected:

* rendered literally
* no parsing, no execution

---

## 16. Unicode / RTL Confusion (visual test)

paypal.com
paypaⅼ.com
abc‮<script>alert("RTL")</script>

Expected:

* no execution
* optional UI warning for spoofing

---

## 17. Redirect-Only Payloads (still must be blocked)

<img src="x" onerror="location.href='https://example.com'">

<a href="javascript:location.href='https://example.com'">redirect</a>

Expected: blocked like any JS execution