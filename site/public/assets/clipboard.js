for (const button of document.querySelectorAll("[data-copy-command]")) {
  const command = button.parentElement?.querySelector("[data-install-command]");
  const status = button.parentElement?.querySelector('[role="status"]');
  if (!command || !status) continue;

  const initialLabel = button.getAttribute("aria-label");
  let timeout;
  let attempt = 0;
  button.disabled = false;
  button.addEventListener("click", async () => {
    const current = ++attempt;
    clearTimeout(timeout);
    let label = "Copied";
    let message = "Copied to the clipboard.";
    try {
      await navigator.clipboard.writeText(command.textContent);
    } catch {
      label = "Select and copy";
      message = "Could not copy. Select the command and copy it.";
    }
    if (current !== attempt) return;
    button.textContent = label;
    button.setAttribute("aria-label", initialLabel.replace("Copy", label));
    status.textContent = message;
    timeout = setTimeout(() => {
      button.textContent = "Copy";
      button.setAttribute("aria-label", initialLabel);
      status.textContent = "";
    }, 2000);
  });
}
