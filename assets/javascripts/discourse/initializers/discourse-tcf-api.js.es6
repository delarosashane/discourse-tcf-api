import { withPluginApi } from "discourse/lib/plugin-api";

function initializeButton(api) {
  api.decoratePluginOutlet('login-before-modal-body', (elem, args) => {
    console.log(123);
  });
}
export default {
  name: "my-button",
  initialize() {
    withPluginApi("0.8.31", initializeButton);
  }
};