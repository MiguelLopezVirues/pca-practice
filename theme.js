// Applied before the page draws, so the chosen theme never flashes. "system" follows the phone.
const choice = localStorage.getItem("pca-theme");
if (choice === "light" || choice === "dark") document.documentElement.dataset.theme = choice;
