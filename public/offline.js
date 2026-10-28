      (function () {
        var pagesStatus = document.getElementById("pages-status");
        var pagesList = document.getElementById("pages");
        var draftsStatus = document.getElementById("drafts-status");
        var draftsList = document.getElementById("drafts");
        var failedStatus = document.getElementById("failed-status");
        var failedList = document.getElementById("failed");
        var actionStatus = document.getElementById("action-status");
        var discardAll = document.getElementById("discard-all");

        var owner = null;
        try {
          owner = localStorage.getItem("fsm:offline-user");
        } catch (error) {
          owner = null;
        }

        if (!owner) {
          pagesStatus.textContent =
            "Logg inn igjen for å se lagrede sider og kladder.";
          draftsStatus.textContent =
            "Logg inn igjen for å se lagrede kladder.";
          discardAll.disabled = true;
          return;
        }

        function openDb() {
          return new Promise(function (resolve, reject) {
            var request = indexedDB.open("fsm-offline", 1);
            request.onerror = function () {
              reject(request.error);
            };
            request.onupgradeneeded = function () {
              var db = request.result;
              if (!db.objectStoreNames.contains("drafts")) {
                db.createObjectStore("drafts", { keyPath: "key" });
              }
              if (!db.objectStoreNames.contains("outbox")) {
                db.createObjectStore("outbox", { keyPath: "id" });
              }
            };
            request.onsuccess = function () {
              resolve(request.result);
            };
          });
        }

        function readAll(storeName) {
          return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
              var tx = db.transaction(storeName, "readonly");
              var all = tx.objectStore(storeName).getAll();
              all.onerror = function () {
                reject(all.error);
              };
              all.onsuccess = function () {
                resolve(all.result || []);
              };
              tx.oncomplete = function () {
                db.close();
              };
              tx.onabort = function () {
                db.close();
                reject(tx.error);
              };
            });
          });
        }

        function payloadIdentity(payload) {
          try {
            var parsed = JSON.parse(payload || "{}");
            var form = parsed.form || parsed;
            return {
              workOrderId: String(parsed.workOrderId || form.workOrderId || ""),
              templateId: String(parsed.templateId || form.templateId || ""),
              notes:
                (form.notes && String(form.notes)) ||
                (parsed.notes && String(parsed.notes)) ||
                "",
            };
          } catch (error) {
            return { workOrderId: "", templateId: "", notes: "" };
          }
        }

        function itemIdentity(item) {
          var fromPayload = payloadIdentity(item.payload);
          return {
            workOrderId: String(item.workOrderId || fromPayload.workOrderId || ""),
            templateId: String(item.templateId || fromPayload.templateId || ""),
            notes: fromPayload.notes,
          };
        }

        function formLink(workOrderId, templateId) {
          return (
            "/mine-oppdrag/" +
            encodeURIComponent(workOrderId) +
            "/skjema/" +
            encodeURIComponent(templateId)
          );
        }

        function formatTime(value) {
          return value ? new Date(value).toLocaleString("nb-NO") : "";
        }

        function failureText(reason) {
          if (reason === "payload-too-large") {
            return "For stor til å sendes automatisk / Too large to send automatically";
          }
          if (reason === "rejected") {
            return "Avvist av serveren / Rejected by the server";
          }
          if (reason === "attempts-exhausted") {
            return "Maks antall forsøk er brukt opp / Maximum retries reached";
          }
          return "Sendingen feilet / Sending failed";
        }

        function renderDrafts(drafts, outbox) {
          draftsList.textContent = "";
          var unsynced = drafts
            .filter(function (draft) {
              return draft.userId === owner;
            })
            .sort(function (a, b) {
              return (b.updatedAt || 0) - (a.updatedAt || 0);
            });

          if (unsynced.length === 0) {
            draftsStatus.textContent = "Ingen lagrede kladder på denne enheten.";
          } else {
            draftsStatus.textContent =
              unsynced.length +
              (unsynced.length === 1
                ? " kladd er lagret."
                : " kladder er lagret.");
          }

          unsynced.forEach(function (draft) {
            var identity = payloadIdentity(draft.payload);
            var matching = outbox.find(function (item) {
              var itemId = itemIdentity(item);
              return (
                item.userId === owner &&
                itemId.workOrderId === draft.workOrderId &&
                itemId.templateId === draft.templateId
              );
            });
            var failed = matching && matching.failedAt;

            var item = document.createElement("li");
            var title = document.createElement("div");
            title.className = "meta";
            title.textContent =
              "Oppdrag " +
              String(draft.workOrderId || "") +
              " · mal " +
              String(draft.templateId || "") +
              (draft.updatedAt ? " · " + formatTime(draft.updatedAt) : "");
            item.appendChild(title);

            if (identity.notes) {
              var preview = document.createElement("div");
              preview.className = "preview";
              preview.textContent =
                identity.notes.length > 160
                  ? identity.notes.slice(0, 160) + " …"
                  : identity.notes;
              item.appendChild(preview);
            }

            var status = document.createElement("div");
            status.className = "status " + (failed ? "failed" : "pending");
            status.textContent = failed
              ? "Kunne ikke sendes: " + failureText(matching.failureReason)
              : draft.syncError === "payload-too-large"
                ? "For stor til å sendes automatisk / Too large to send automatically"
                : (draft.syncedAt || 0) >= (draft.updatedAt || 0)
                  ? "Sendt / Sent"
                  : "Venter på sending / Waiting to send";
            item.appendChild(status);

            var row = document.createElement("div");
            row.className = "row";
            var link = document.createElement("a");
            link.href = formLink(
              String(draft.workOrderId || ""),
              String(draft.templateId || ""),
            );
            link.textContent = "Åpne kladden / Open draft";
            row.appendChild(link);

            var deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "danger";
            deleteButton.textContent = "Slett / Delete";
            deleteButton.addEventListener("click", function () {
              if (
                !window.confirm(
                  "Slette kladden for oppdrag " +
                    String(draft.workOrderId || "") +
                    "? / Delete this draft?",
                )
              ) {
                return;
              }
              deleteReport(
                String(draft.workOrderId || ""),
                String(draft.templateId || ""),
              );
            });
            row.appendChild(deleteButton);
            item.appendChild(row);
            draftsList.appendChild(item);
          });

          var failedItems = outbox.filter(function (item) {
            return item.userId === owner && item.failedAt;
          });
          failedList.textContent = "";
          if (failedItems.length === 0) {
            failedStatus.textContent = "Ingen feilede sendinger.";
            return;
          }
          failedStatus.textContent =
            failedItems.length +
            (failedItems.length === 1
              ? " kladd kunne ikke sendes."
              : " kladder kunne ikke sendes.");
          failedItems.forEach(function (item) {
            var identity = itemIdentity(item);
            var entry = document.createElement("li");
            var meta = document.createElement("div");
            meta.className = "meta";
            meta.textContent =
              "Oppdrag " +
              identity.workOrderId +
              " · mal " +
              identity.templateId +
              " · " +
              failureText(item.failureReason);
            entry.appendChild(meta);

            var row = document.createElement("div");
            row.className = "row";
            var link = document.createElement("a");
            link.href = formLink(identity.workOrderId, identity.templateId);
            link.textContent = "Åpne kladden / Open draft";
            row.appendChild(link);

            var deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "danger";
            deleteButton.textContent = "Slett / Delete";
            deleteButton.addEventListener("click", function () {
              if (!window.confirm("Slette den feilede kladden? / Delete it?")) {
                return;
              }
              deleteReport(identity.workOrderId, identity.templateId);
            });
            row.appendChild(deleteButton);
            entry.appendChild(row);
            failedList.appendChild(entry);
          });
        }

        function deleteReport(workOrderId, templateId) {
          actionStatus.textContent = "Sletter … / Deleting …";
          openDb()
            .then(function (db) {
              return new Promise(function (resolve, reject) {
                var tx = db.transaction(["drafts", "outbox"], "readwrite");
                var drafts = tx.objectStore("drafts");
                var outbox = tx.objectStore("outbox");

                var draftCursor = drafts.openCursor();
                draftCursor.onsuccess = function () {
                  var cursor = draftCursor.result;
                  if (!cursor) {
                    var outboxCursor = outbox.openCursor();
                    outboxCursor.onsuccess = function () {
                      var itemCursor = outboxCursor.result;
                      if (!itemCursor) return;
                      var value = itemCursor.value;
                      var identity = itemIdentity(value);
                      if (
                        value.userId === owner &&
                        identity.workOrderId === workOrderId &&
                        identity.templateId === templateId
                      ) {
                        itemCursor.delete();
                      }
                      itemCursor.continue();
                    };
                    outboxCursor.onerror = function () {
                      reject(outboxCursor.error);
                    };
                    return;
                  }
                  var draft = cursor.value;
                  if (
                    draft.userId === owner &&
                    String(draft.workOrderId || "") === workOrderId &&
                    String(draft.templateId || "") === templateId
                  ) {
                    cursor.delete();
                  }
                  cursor.continue();
                };
                draftCursor.onerror = function () {
                  reject(draftCursor.error);
                };
                tx.oncomplete = function () {
                  db.close();
                  resolve();
                };
                tx.onabort = function () {
                  db.close();
                  reject(tx.error);
                };
              });
            })
            .then(function () {
              actionStatus.textContent = "Kladden er slettet. / Draft deleted.";
              load();
            })
            .catch(function () {
              actionStatus.textContent =
                "Kunne ikke slette kladden. / Could not delete the draft.";
            });
        }

        function discardAllDrafts() {
          // Samme operasjon som clearOfflineUserData i
          // src/lib/offline/draft-outbox.ts. Denne siden er statisk og kan
          // derfor ikke importere appkoden.
          if (
            !window.confirm(
              "Forkaste ALLE lokale kladder og ventende sendinger for denne brukeren? Dette kan ikke angres.",
            )
          ) {
            return;
          }
          actionStatus.textContent = "Forkaster … / Discarding …";
          openDb()
            .then(function (db) {
              return new Promise(function (resolve, reject) {
                var tx = db.transaction(["drafts", "outbox"], "readwrite");
                var drafts = tx.objectStore("drafts").openCursor();
                var outbox = tx.objectStore("outbox").openCursor();

                drafts.onsuccess = function () {
                  var cursor = drafts.result;
                  if (!cursor) return;
                  if (cursor.value.userId === owner) cursor.delete();
                  cursor.continue();
                };
                outbox.onsuccess = function () {
                  var cursor = outbox.result;
                  if (!cursor) return;
                  if (cursor.value.userId === owner) cursor.delete();
                  cursor.continue();
                };
                drafts.onerror = function () {
                  reject(drafts.error);
                };
                outbox.onerror = function () {
                  reject(outbox.error);
                };
                tx.oncomplete = function () {
                  db.close();
                  resolve();
                };
                tx.onabort = function () {
                  db.close();
                  reject(tx.error);
                };
              });
            })
            .then(function () {
              actionStatus.textContent =
                "Alle kladder er forkastet. / All drafts discarded.";
              load();
            })
            .catch(function () {
              actionStatus.textContent =
                "Kunne ikke forkaste kladene. / Could not discard drafts.";
            });
        }

        function renderPages() {
          if (!("caches" in window)) {
            pagesStatus.textContent = "Nettleseren støtter ikke offline-sider.";
            return;
          }
          var prefix = "fsm-pages-v1:" + owner;
          caches
            .keys()
            .then(function (names) {
              if (names.indexOf(prefix) === -1) return [];
              return caches.open(prefix).then(function (cache) {
                return cache.keys();
              });
            })
            .then(function (requests) {
              var seen = {};
              var pages = [];
              requests.forEach(function (request) {
                try {
                  var url = new URL(request.url);
                  if (url.searchParams.get("__fsm") !== "html") return;
                  if (!url.pathname.startsWith("/mine-oppdrag")) return;
                  if (seen[url.pathname]) return;
                  seen[url.pathname] = true;
                  pages.push(url.pathname);
                } catch (error) {
                  // Hopp over ugyldige cache-nøkler.
                }
              });
              pages.sort();
              pagesList.textContent = "";
              if (pages.length === 0) {
                pagesStatus.textContent =
                  "Ingen sider er lagret ennå. Åpne et oppdrag med nett først.";
                return;
              }
              pagesStatus.textContent =
                pages.length +
                (pages.length === 1
                  ? " side er lagret."
                  : " sider er lagret.");
              pages.forEach(function (path) {
                var item = document.createElement("li");
                var link = document.createElement("a");
                link.href = path;
                var parts = path.split("/").filter(Boolean);
                if (path === "/mine-oppdrag") {
                  link.textContent = "Mine oppdrag / My work orders";
                } else if (parts.length === 2) {
                  link.textContent =
                    "Oppdrag " +
                    decodeURIComponent(parts[1]) +
                    " / Work order";
                } else {
                  link.textContent =
                    "Skjema for oppdrag " +
                    decodeURIComponent(parts[1] || "") +
                    " / Report form";
                }
                item.appendChild(link);
                pagesList.appendChild(item);
              });
            })
            .catch(function () {
              pagesStatus.textContent =
                "Kunne ikke lese lagrede sider. / Could not read stored pages.";
            });
        }

        function load() {
          if (!("indexedDB" in window)) {
            draftsStatus.textContent =
              "Nettleseren støtter ikke lokal lagring.";
            failedStatus.textContent = "";
            return;
          }
          Promise.all([readAll("drafts"), readAll("outbox")])
            .then(function (result) {
              renderDrafts(result[0], result[1]);
            })
            .catch(function () {
              draftsStatus.textContent =
                "Kunne ikke lese lagrede kladder. / Could not read drafts.";
            });
          renderPages();
        }

        discardAll.addEventListener("click", discardAllDrafts);
        load();
      })();
