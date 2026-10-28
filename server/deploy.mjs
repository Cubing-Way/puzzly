// Put the solve server built by server/build.mjs on AWS Lambda: the zip goes to the deploy bucket (too big to send straight), the function takes its code
// from there, and the zip leaves the bucket (the function keeps its own copy, so nothing stays billed). Needs the AWS CLI signed in (aws configure);
// the names are the ones the README's "Solve server" sets up, or FUNCTION and BUCKET (AWS_CLI: the aws command, if it isn't on the path)
import { execFileSync } from "node:child_process";

const AWS = process.env.AWS_CLI ?? "aws";
const FUNCTION = process.env.FUNCTION ?? "caio-puzzly";
const BUCKET = process.env.BUCKET ?? "caio-puzzly-deploy";
const KEY = "puzzly-server.zip";

// One AWS CLI command, its output shown
const aws = (...args) => execFileSync(AWS, args, { stdio: "inherit" });

aws("s3", "cp", `server/out/${KEY}`, `s3://${BUCKET}/${KEY}`);
aws("lambda", "update-function-code", "--function-name", FUNCTION, "--s3-bucket", BUCKET, "--s3-key", KEY, "--query", "CodeSize", "--output", "text");
aws("lambda", "wait", "function-updated-v2", "--function-name", FUNCTION);
aws("s3", "rm", `s3://${BUCKET}/${KEY}`);
console.log(`${FUNCTION} runs the new code`);
