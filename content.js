const html = document.documentElement.outerHTML;

fetch("http://localhost:8000/api/send_html", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ html: html })
});
