import React from "react";
import ReactDOM from "react-dom/client";
import LatencyLabView from "./features/workbench/LatencyLabView";
import "./app.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <LatencyLabView />
  </React.StrictMode>,
);
