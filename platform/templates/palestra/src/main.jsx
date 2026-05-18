import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./index.css";

// In produzione l'app vive sotto /demo/palestra/. React Router deve
// avere lo stesso basename per linkare correttamente fra le pagine.
const basename = import.meta.env.PROD ? "/demo/palestra" : "/";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
