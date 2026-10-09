import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/manrope/latin-400.css";
import "@fontsource/manrope/latin-500.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "@fontsource/sora/latin-500.css";
import "@fontsource/sora/latin-600.css";
import App from "./App";
import JobRunPage from "./JobRunPage";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).has("job-run") ? (
      <JobRunPage />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
