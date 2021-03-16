import { withPluginApi } from "discourse/lib/plugin-api";
import Controller, { inject as controller } from "@ember/controller";
import { areCookiesEnabled, escapeExpression } from "discourse/lib/utilities";
import cookie, { removeCookie } from "discourse/lib/cookie";
import { next, schedule } from "@ember/runloop";
import I18n from "I18n";
import { SECOND_FACTOR_METHODS } from "discourse/models/user";
import { ajax } from "discourse/lib/ajax";
import bootbox from "bootbox";
import { escape } from "pretty-text/sanitizer";
import { isEmpty } from "@ember/utils";

function modifyLoginButton(api) {
  api.modifyClass('controller:login', {
    createAccount: controller(),
    actions: {
      login() {
        // Declare variables here
        var tcf_api_url = this.siteSettings.tcf_api_url;
        var discourse_api_url = this.siteSettings.discourse_api_url;
        var discourse_api_key = this.siteSettings.discourse_api_key;
        var discourse_api_username = this.siteSettings.discourse_api_username;

        if (this.loginDisabled) {
          return;
        }
  
        if (isEmpty(this.loginName) || isEmpty(this.loginPassword)) {
          this.flash(I18n.t("login.blank_username_or_password"), "error");
          console.log("it works");
          return;
        }
  
        this.set("loggingIn", true);

        let testVar = this;
  
        // log in tcf api first
        ajax({
          url: tcf_api_url.concat("/api/v1/authenticate"),
          type: "POST",
          cors: true,
          dataType: 'json',
          data: {
              identifier: this.loginName,
              password: this.loginPassword
          },
          secure: true,
          headers: {
            'Access-Control-Allow-Origin': '*',
          },      
          statusCode: {
            404: function (xhr) {
              console.log(xhr)
                var err = xhr.responseJSON;
                console.log('Message: ' + err.message);
                testVar.set("loggingIn", false);
                testVar.flash(err.message, "error");
                // throw err.Message; // removed because this was always an "uncaught exception", even if used within try/catch
            },
            401: function (xhr) {
              console.log(xhr)
              var err = xhr.responseJSON;
                console.log('Message:' + err.message);
                testVar.set("loggingIn", false);
                testVar.flash(err.message, "error");
                // this.flash(result.error, "error");
                // Do nothing here - put result into cache regardless of status code
            }
        }
        }).then(
          (result) => {
            var data = result.data[0];

            ajax({
              url: discourse_api_url.concat("/u/", data.username, ".json"),
              type: "GET",
              headers: {
                'Api-Key': discourse_api_key,
                'Api-Username': discourse_api_username
              }
            }).then(
              (result) => {
                if (result && result.user) {
                  ajax("/session", {
                    type: "POST",
                    data: {
                      login: this.loginName,
                      password: this.loginPassword,
                      second_factor_token:
                        this.securityKeyCredential || this.secondFactorToken,
                      second_factor_method: this.secondFactorMethod,
                      timezone: moment.tz.guess(),
                    },
                  }).then(
                    (result) => {
                      // Successful login
                      if (result && result.error) {
                        this.set("loggingIn", false);
  
                        if (
                          (result.security_key_enabled || result.totp_enabled) &&
                          !this.secondFactorRequired
                        ) {
                          this.setProperties({
                            otherMethodAllowed: result.multiple_second_factor_methods,
                            secondFactorRequired: true,
                            showLoginButtons: false,
                            backupEnabled: result.backup_enabled,
                            showSecondFactor: result.totp_enabled,
                            showSecurityKey: result.security_key_enabled,
                            secondFactorMethod: result.security_key_enabled
                              ? SECOND_FACTOR_METHODS.SECURITY_KEY
                              : SECOND_FACTOR_METHODS.TOTP,
                            securityKeyChallenge: result.challenge,
                            securityKeyAllowedCredentialIds: result.allowed_credential_ids,
                          });
  
                          // only need to focus the 2FA input for TOTP
                          if (!this.showSecurityKey) {
                            schedule("afterRender", () =>
                              document
                                .getElementById("second-factor")
                                .querySelector("input")
                                .focus()
                            );
                          }
  
                          return;
                        } else if (result.reason === "not_activated") {
                          this.send("showNotActivated", {
                            username: this.loginName,
                            sentTo: escape(result.sent_to_email),
                            currentEmail: escape(result.current_email),
                          });
                        } else if (result.reason === "suspended") {
                          this.send("closeModal");
                          bootbox.alert(result.error);
                        } else {
                          this.flash(result.error, "error");
                        }
                      } else {
                        this.set("loggedIn", true);
                        // Trigger the browser's password manager using the hidden static login form:
                        const hiddenLoginForm = document.getElementById(
                          "hidden-login-form"
                        );
                        const applyHiddenFormInputValue = (value, key) => {
                          if (!hiddenLoginForm) {
                            return;
                          }
  
                          hiddenLoginForm.querySelector(`input[name=${key}]`).value = value;
                        };
  
                        const destinationUrl = cookie("destination_url");
                        const ssoDestinationUrl = cookie("sso_destination_url");
  
                        applyHiddenFormInputValue(this.loginName, "username");
                        applyHiddenFormInputValue(this.loginPassword, "password");
  
                        if (ssoDestinationUrl) {
                          removeCookie("sso_destination_url");
                          window.location.assign(ssoDestinationUrl);
                          return;
                        } else if (destinationUrl) {
                          // redirect client to the original URL
                          removeCookie("destination_url");
  
                          applyHiddenFormInputValue(destinationUrl, "redirect");
                        } else {
                          applyHiddenFormInputValue(window.location.href, "redirect");
                        }
  
                        if (hiddenLoginForm) {
                          if (
                            navigator.userAgent.match(/(iPad|iPhone|iPod)/g) &&
                            navigator.userAgent.match(/Safari/g)
                          ) {
                            // In case of Safari on iOS do not submit hidden login form
                            window.location.href = hiddenLoginForm.querySelector(
                              "input[name=redirect]"
                            ).value;
                          } else {
                            hiddenLoginForm.submit();
                          }
                        }
                        return;
                      }
                    },
                    (e) => {
                      // Failed to login
                      if (e.jqXHR && e.jqXHR.status === 429) {
                        this.flash(I18n.t("login.rate_limit"), "error");
                      } else if (!areCookiesEnabled()) {
                        this.flash(I18n.t("login.cookies_error"), "error");
                      } else {
                        this.flash(I18n.t("login.error"), "error");
                      }
                      this.set("loggingIn", false);
                    }
                  );
                }
                // if user exists in api but not in discourse, register the user in discourse db
                else {
                  ajax({
                    url: discourse_api_url.concat("/users.json"),
                    type: "POST",
                    data: {
                      'name': data.first_name,
                      'email': data.email,
                      'password': this.loginPassword,
                      'username': data.username,
                      'active': true,
                      'approved': true,
                      'user_fields[1]': 'string'
                    },
                    headers: {
                      'Api-Key': discourse_api_key,
                      'Api-Username': discourse_api_username
                    }
                  }).then(
                    (result) => {
                      ajax("/session", {
                        type: "POST",
                        data: {
                          login: this.loginName,
                          password: this.loginPassword,
                          second_factor_token:
                            this.securityKeyCredential || this.secondFactorToken,
                          second_factor_method: this.secondFactorMethod,
                          timezone: moment.tz.guess(),
                        },
                      }).then(
                        (result) => {
                          // Successful login
                          if (result && result.error) {
                            this.set("loggingIn", false);
      
                            if (
                              (result.security_key_enabled || result.totp_enabled) &&
                              !this.secondFactorRequired
                            ) {
                              this.setProperties({
                                otherMethodAllowed: result.multiple_second_factor_methods,
                                secondFactorRequired: true,
                                showLoginButtons: false,
                                backupEnabled: result.backup_enabled,
                                showSecondFactor: result.totp_enabled,
                                showSecurityKey: result.security_key_enabled,
                                secondFactorMethod: result.security_key_enabled
                                  ? SECOND_FACTOR_METHODS.SECURITY_KEY
                                  : SECOND_FACTOR_METHODS.TOTP,
                                securityKeyChallenge: result.challenge,
                                securityKeyAllowedCredentialIds: result.allowed_credential_ids,
                              });
      
                              // only need to focus the 2FA input for TOTP
                              if (!this.showSecurityKey) {
                                schedule("afterRender", () =>
                                  document
                                    .getElementById("second-factor")
                                    .querySelector("input")
                                    .focus()
                                );
                              }
      
                              return;
                            } else if (result.reason === "not_activated") {
                              this.send("showNotActivated", {
                                username: this.loginName,
                                sentTo: escape(result.sent_to_email),
                                currentEmail: escape(result.current_email),
                              });
                            } else if (result.reason === "suspended") {
                              this.send("closeModal");
                              bootbox.alert(result.error);
                            } else {
                              this.flash(result.error, "error");
                            }
                          } else {
                            this.set("loggedIn", true);
                            // Trigger the browser's password manager using the hidden static login form:
                            const hiddenLoginForm = document.getElementById(
                              "hidden-login-form"
                            );
                            const applyHiddenFormInputValue = (value, key) => {
                              if (!hiddenLoginForm) {
                                return;
                              }
      
                              hiddenLoginForm.querySelector(`input[name=${key}]`).value = value;
                            };
      
                            const destinationUrl = cookie("destination_url");
                            const ssoDestinationUrl = cookie("sso_destination_url");
      
                            applyHiddenFormInputValue(this.loginName, "username");
                            applyHiddenFormInputValue(this.loginPassword, "password");
      
                            if (ssoDestinationUrl) {
                              removeCookie("sso_destination_url");
                              window.location.assign(ssoDestinationUrl);
                              return;
                            } else if (destinationUrl) {
                              // redirect client to the original URL
                              removeCookie("destination_url");
      
                              applyHiddenFormInputValue(destinationUrl, "redirect");
                            } else {
                              applyHiddenFormInputValue(window.location.href, "redirect");
                            }
      
                            if (hiddenLoginForm) {
                              if (
                                navigator.userAgent.match(/(iPad|iPhone|iPod)/g) &&
                                navigator.userAgent.match(/Safari/g)
                              ) {
                                // In case of Safari on iOS do not submit hidden login form
                                window.location.href = hiddenLoginForm.querySelector(
                                  "input[name=redirect]"
                                ).value;
                              } else {
                                hiddenLoginForm.submit();
                              }
                            }
                            return;
                          }
                        },
                        (e) => {
                          // Failed to login
                          if (e.jqXHR && e.jqXHR.status === 429) {
                            this.flash(I18n.t("login.rate_limit"), "error");
                          } else if (!areCookiesEnabled()) {
                            this.flash(I18n.t("login.cookies_error"), "error");
                          } else {
                            this.flash(I18n.t("login.error"), "error");
                          }
                          this.set("loggingIn", false);
                        }
                      );
                    }                 
                  );
                }
              }
            );
          },
          (e) => {
            console.log(e.jqXHR);

            if (e.jqXHR && e.jqXHR.status === 404){
              var json = e.jqXHR.responseJSON;
              this.flash(I18n.t(json.message), "error");
            }
            if (e.jqXHR && e.jqXHR.status === 401){
              console.log("haha")
              var json = e.jqXHR.responseJSON;
              this.flash(I18n.t(json.message), "error");
            }
            // Failed to login
            if (e.jqXHR && e.jqXHR.status === 429) {
              this.flash(I18n.t("login.rate_limit"), "error");
            } else if (!areCookiesEnabled()) {
              this.flash(I18n.t("login.cookies_error"), "error");
            } else {
              this.flash(I18n.t("login.error"), "error");
            }
            this.set("loggingIn", false);
          }
        );
        return false;
      }
    }
  });
}

export default {
  name: "discourse-tcf-api-login",
  initialize() {
    withPluginApi("0.8.31", modifyLoginButton);
  }
};