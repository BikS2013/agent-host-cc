/**
 * SPA entry point.
 *
 * Vite serves `index.html`, which loads this module. We import the
 * stylesheet (so Vite bundles it), the root `App` component (owned by
 * Coder C), and the global state, then mount Preact onto `<div id="app">`.
 *
 * The `loadProfiles()` side-effect runs immediately after mount so the
 * dropdown is populated by the time the user sees the UI.
 */

import { render } from "preact";

import { App } from "./components/App";
import { loadProfiles } from "./state";
import "./styles.css";

const root = document.getElementById("app");
if (root === null) {
  // Surface as a hard failure: the SPA cannot run without its mount
  // point. We avoid silently creating a div because that would mask
  // a broken `index.html`.
  throw new Error('SPA mount failed: <div id="app"> not found in document.');
}

render(<App />, root);

// Kick off the initial profile load. We deliberately do not `await`
// here — the render must be synchronous so the user sees the empty
// shell immediately while the network request is in flight.
void loadProfiles();
