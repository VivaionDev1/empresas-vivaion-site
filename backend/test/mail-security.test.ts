import assert from "node:assert/strict";
import test from "node:test";
import {
  validateRelayDestination,
  isPublicRelayAddress,
  resolvePublicRelayAddress
} from "../src/domain/mailRelaySecurity.ts";

const authorized = "relay.provider.example.com";

test("only the exact explicitly-approved HTTPS relay host is accepted", () => {
  assert.equal(validateRelayDestination("https://"+authorized+"/send",authorized).hostname,authorized);
  assert.throws(() => validateRelayDestination("https://another.example.com/send",authorized));
  assert.throws(() => validateRelayDestination("https://"+authorized+".attacker.com/send",authorized));
  assert.throws(() => validateRelayDestination("https://evil-"+authorized+"/send",authorized));
  assert.throws(() => validateRelayDestination("http://"+authorized+"/send",authorized));
  assert.throws(() => validateRelayDestination("https://"+authorized+":8443/send",authorized));
  assert.throws(() => validateRelayDestination("https://user:pass@"+authorized+"/send",authorized));
  assert.throws(() => validateRelayDestination("https://"+authorized+"/send#fragment",authorized));
  assert.throws(() => validateRelayDestination("https://127.0.0.1/send","127.0.0.1"));
  assert.throws(() => validateRelayDestination("https://[::1]/send","[::1]"));
  assert.throws(() => validateRelayDestination("https://localhost/send","localhost"));
  assert.throws(() => validateRelayDestination("https://relay.local/send","relay.local"));
  assert.throws(() => validateRelayDestination("https://"+authorized+"/send",""));
  assert.throws(() => validateRelayDestination("https://"+authorized+"/send","*.example.com"));
});

test("unsafe IPv4 and IPv6 destinations, including metadata and mapped IPv4, are blocked", () => {
  for (const address of ["127.0.0.1","0.0.0.0","10.0.0.5","172.16.1.5",
    "192.168.1.1","169.254.169.254","100.64.0.1","192.0.2.1",
    "198.18.0.1","198.51.100.1","203.0.113.1","224.0.0.1"]) {
    assert.equal(isPublicRelayAddress({address,family:4}),false,address);
  }
  for (const address of ["::1","::","fe80::1","fc00::1",
    "::ffff:127.0.0.1","2001:db8::1","2002:c0a8:101::1"]) {
    assert.equal(isPublicRelayAddress({address,family:6}),false,address);
  }
  assert.equal(isPublicRelayAddress({address:"8.8.8.8",family:4}),true);
  assert.equal(isPublicRelayAddress({address:"1.1.1.1",family:4}),true);
  assert.equal(isPublicRelayAddress({address:"2606:4700:4700::1111",family:6}),true);
  assert.equal(isPublicRelayAddress({address:"127.0.0.1",family:6}),false);
  assert.equal(isPublicRelayAddress({address:"::1",family:4}),false);
});

test("DNS rebinding and split DNS with even one private address fail closed", async () => {
  const resolver = async () => [
    {address:"1.1.1.1",family:4},
    {address:"169.254.169.254",family:4}
  ];
  await assert.rejects(resolvePublicRelayAddress(authorized,resolver),/dns_blocked/);
  await assert.rejects(resolvePublicRelayAddress(authorized,async () => [
    {address:"2606:4700:4700::1111",family:6},{address:"::1",family:6}
  ]),/dns_blocked/);
  await assert.rejects(resolvePublicRelayAddress(authorized,async () => []),/dns_blocked/);
  await assert.rejects(resolvePublicRelayAddress("localhost",async () => [
    {address:"1.1.1.1",family:4}
  ]),/hostname_invalid/);
});

test("all-public DNS returns a pinned address without a second resolver call", async () => {
  let calls = 0;
  const resolved = await resolvePublicRelayAddress(authorized,async (name) => {
    calls++;
    assert.equal(name,authorized);
    return [{address:"1.1.1.1",family:4},{address:"2606:4700:4700::1111",family:6}];
  });
  assert.deepEqual(resolved,{address:"1.1.1.1",family:4});
  assert.equal(calls,1);
});
