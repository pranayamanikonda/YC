import { test } from "node:test";
import assert from "node:assert/strict";
import { validateConfig, TARGETS } from "../src/contract/config.mjs";

/** @param {{ findings: any[] }} result A validateConfig result. */
function errors(result) {
  return result.findings.filter((f) => f.severity === "error");
}

const dockerBase = {
  contract: 1,
  orgId: "acme",
  publicUrl: "https://qm.acme.com",
  target: "docker",
  services: { core: true },
  sandbox: { app: "registry/qm-sandbox" },
};

test("a minimal valid docker config passes", () => {
  const res = validateConfig(dockerBase);
  assert.equal(res.ok, true, JSON.stringify(res.findings));
});

test("TARGETS is the v1 set", () => {
  assert.deepEqual([...TARGETS], ["docker", "fly", "aws"]);
});

test("missing required root fields fail under config.v1", () => {
  const res = validateConfig({ contract: 1 });
  const clauses = new Set(res.findings.map((f) => f.clause));
  assert.ok(clauses.has("config.v1"));
  const paths = res.findings.map((f) => f.path);
  for (const p of ["orgId", "publicUrl", "target", "services"]) {
    assert.ok(paths.includes(p), `expected a finding for ${p}`);
  }
});

test("services must include core", () => {
  const res = validateConfig({ ...dockerBase, services: { web: true } });
  assert.match(errors(res).map((f) => f.message).join(), /must include `core`/);
});

test("unknown contract major fails closed", () => {
  const res = validateConfig({ ...dockerBase, contract: 99 });
  assert.match(errors(res).map((f) => f.message).join(), /newer than this CLI understands/);
});

test("unknown target is rejected", () => {
  const res = validateConfig({ ...dockerBase, target: "gcp" });
  assert.match(errors(res).map((f) => f.message).join(), /target must be one of/);
});

test("docker and fly require sandbox.app", () => {
  const { sandbox, ...noSandbox } = dockerBase;
  assert.match(errors(validateConfig(noSandbox)).map((f) => f.path).join(), /sandbox.app/);
});

test("http publicUrl warns on docker but errors elsewhere", () => {
  const docker = validateConfig({ ...dockerBase, publicUrl: "http://localhost:3000" });
  assert.ok(docker.ok, "docker should tolerate http with a warning");
  assert.ok(docker.findings.some((f) => f.severity === "warning" && /HTTPS/.test(f.message)));

  const fly = validateConfig({
    contract: 1,
    orgId: "acme",
    publicUrl: "http://qm.acme.com",
    target: "fly",
    services: { core: true },
    region: "iad",
    flyOrg: "acme",
    sandbox: { app: "registry/x" },
  });
  assert.ok(fly.findings.some((f) => f.severity === "error" && /HTTPS/.test(f.message)));
});

test("config env rejects secret-shaped and derived keys", () => {
  const res = validateConfig({
    ...dockerBase,
    env: { LOG_LEVEL: "info", GH_TOKEN: "x", QM_ADMIN_URL: "https://evil" },
  });
  const msgs = errors(res).map((f) => f.message).join("\n");
  assert.match(msgs, /secret-shaped/);
  assert.match(msgs, /derived from publicUrl/);
  assert.ok(errors(res).every((f) => f.clause === "config.no-secret-values"));
});

test("fly requires region and flyOrg", () => {
  const res = validateConfig({
    contract: 1,
    orgId: "acme",
    publicUrl: "https://qm.acme.com",
    target: "fly",
    services: { core: true },
    sandbox: { app: "registry/x" },
  });
  const paths = errors(res).map((f) => f.path);
  assert.ok(paths.includes("region"));
  assert.ok(paths.includes("flyOrg"));
});

const awsBase = {
  contract: 1,
  orgId: "acme",
  publicUrl: "https://qm.acme.com",
  target: "aws",
  services: { core: true },
  aws: {
    account: "123456789012",
    region: "us-east-1",
    label: "prod",
    cluster: "qm-prod",
    deployRoleArn: "arn:aws:iam::123456789012:role/qm-deploy",
    secretsPrefix: "qm/prod",
    namespace: "qm.internal",
    workloads: {
      core: { ecrRepository: "qm/core", ecsService: "qm-core", cpu: 1024, memory: 2048 },
    },
  },
};

test("a valid aws config passes (default MicroVM sandbox, no sandbox block)", () => {
  const res = validateConfig(awsBase);
  assert.equal(res.ok, true, JSON.stringify(res.findings));
});

test("aws account must be 12 digits", () => {
  const res = validateConfig({ ...awsBase, aws: { ...awsBase.aws, account: "123" } });
  assert.match(errors(res).map((f) => f.path).join(), /aws.account/);
});

test("aws sandbox block requires an explicit backend", () => {
  const res = validateConfig({ ...awsBase, sandbox: {} });
  assert.match(errors(res).map((f) => f.message).join(), /requires `sandbox.backend`/);
});

test("aws sandbox backend sprites requires sandbox.app", () => {
  const res = validateConfig({ ...awsBase, sandbox: { backend: "sprites" } });
  assert.match(errors(res).map((f) => f.path).join(), /sandbox.app/);

  const ok = validateConfig({ ...awsBase, sandbox: { backend: "sprites", app: "registry/layer" } });
  assert.equal(ok.ok, true, JSON.stringify(ok.findings));
});

test("aws requires a workload entry per enabled service with unique names", () => {
  const res = validateConfig({
    ...awsBase,
    services: { core: true, web: true },
    aws: {
      ...awsBase.aws,
      workloads: {
        core: { ecrRepository: "qm/core", ecsService: "qm-core", cpu: 1024, memory: 2048 },
        web: { ecrRepository: "qm/core", ecsService: "qm-core", cpu: 1024, memory: 2048 },
      },
    },
  });
  const msgs = errors(res).map((f) => f.message).join("\n");
  assert.match(msgs, /not unique/);
});

test("aws rejects an invalid Fargate size under aws.rendered-task", () => {
  const res = validateConfig({
    ...awsBase,
    aws: {
      ...awsBase.aws,
      workloads: { core: { ecrRepository: "qm/core", ecsService: "qm-core", cpu: 256, memory: 4096 } },
    },
  });
  assert.ok(res.findings.some((f) => f.clause === "aws.rendered-task" && f.severity === "error"));
});

test("external prebuilt image workloads must declare architecture", () => {
  const res = validateConfig({
    ...awsBase,
    aws: {
      ...awsBase.aws,
      workloads: {
        core: { ecrRepository: "qm/core", ecsService: "qm-core", cpu: 1024, memory: 2048, image: "registry/x@sha256:abc" },
      },
    },
  });
  assert.match(errors(res).map((f) => f.path).join(), /architecture/);
});

test("securityScreen requires proxy shape and the routed token", () => {
  const res = validateConfig({
    ...dockerBase,
    securityScreen: { backend: "proxy", provider: "acme", endpoint: "https://screen.acme.com", rollout: "shadow" },
  });
  assert.match(errors(res).map((f) => f.path).join(), /SECURITY_SCREEN_PROXY_TOKEN/);

  const ok = validateConfig({
    ...dockerBase,
    securityScreen: { backend: "proxy", provider: "acme", endpoint: "https://screen.acme.com", rollout: "enforce" },
    secretEnv: { core: { SECURITY_SCREEN_PROXY_TOKEN: "x" } },
  });
  assert.equal(ok.ok, true, JSON.stringify(ok.findings));
});

test("securityScreen provider must be lowercase and endpoint HTTPS", () => {
  const res = validateConfig({
    ...dockerBase,
    securityScreen: { backend: "proxy", provider: "Acme", endpoint: "http://x", rollout: "bad" },
    secretEnv: { core: { SECURITY_SCREEN_PROXY_TOKEN: "x" } },
  });
  const msgs = errors(res).map((f) => f.message).join("\n");
  assert.match(msgs, /lowercase label/);
  assert.match(msgs, /HTTPS URL/);
  assert.match(msgs, /"shadow" or "enforce"/);
});
