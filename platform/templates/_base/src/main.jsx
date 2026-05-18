import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./index.css";

// In produzione l'app vive sotto __BASE_PATH__ (sostituito al build time).
// Rimuovo la trailing slash per il basename del Router.
const PROD_BASENAME = "__BASE_PATH__".replace(/\/$/, "");
const basename = import.meta.env.PROD ? PROD_BASENAME : "/";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
