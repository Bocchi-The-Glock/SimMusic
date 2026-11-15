#!/bin/sh
set -eu
NODE="${1:-/opt/simmusic/node/bin/node}"
uname -r
getconf GNU_LIBC_VERSION
"$NODE" --input-type=module -e '
import { DatabaseSync } from "node:sqlite";
import { webcrypto } from "node:crypto";
if (+process.versions.node.split(".")[0] < 22) throw Error("Node 22.13+ required");
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE t (id INTEGER); INSERT INTO t VALUES (1)");
if (db.prepare("SELECT id FROM t").get().id !== 1) throw Error("SQLite test failed");
await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode("test"));
db.close(); console.log("Runtime preflight passed:", process.version);
'
df -h /opt /var/lib
free -h
ss -lnt | awk 'NR==1 || /:3100[[:space:]]|:8080[[:space:]]/'
