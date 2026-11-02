try {
  const t = localStorage.getItem("testimus.theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch {}
