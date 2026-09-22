// Must come before any module that imports `@solana/web3.js`; web3.js and the
// Anchor client assume a global `Buffer`. See `lib/polyfills.ts`.
import "./lib/polyfills";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
