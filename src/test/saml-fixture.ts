import { SignedXml } from "xml-crypto";
import type { SamlProviderConfig } from "@/lib/saml";

/**
 * Test-IdP for SAML. Sertifikatet og nøkkelen er et fast, selvsignert
 * testpar – aldri brukt utenfor testene. Assertionen signeres med xml-crypto,
 * slik at node-saml faktisk validerer en ekte XML-signatur.
 */
export const SAML_TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDJHPpSg6ma20h6
TWcg9fEQTEZ0fBFYa8/Vw8bDOU+gEZf6vsesUx1d/TsaFFqC5pwgUnU10LA3cRUD
EDL8wI9VzUmnHnEkfUPKjUY2uAGYR14HBuzd7BZoU1JcgdXWGrQX9ZV1XABYKbnT
ZCWbfTV2y7zneOf/Wu5WCIz/asOKHhPkn0/Lq4nPIYJP4E+wgL+Q+Y2ozLBFxeGA
q2AEKGo9Dx0KutNISzG6Nb5H+CITe3A7jNnzwx47Wqnp7iwvAV/fTF3v759H9UVU
yXYHywkprbuIevUDfG+AtQcVmPkbBbpiMjgBSI5KJ+vXnY5EUILbWEOJwpd03/WD
ISZP1AXFAgMBAAECgf810AsrCQ/Y39QE5bEyoJxgQAiaIpiBkFeMW1ZT5oHn0s1X
yrSi55p0C85ErC2L2SjtfSLfw3djXl7A8xSxjNTNoKCUlxCvMtVw3VxsR9AlbvM5
7iBzQTi9sY3YMuWE5KBLyOq0/GkbLg8LAUEO2fH0V4+0YCWzriEX5DHWJjssOWXR
LS13q8EwwT34bqDi51IEFnTbEJXonuCauUX5fe/hshA4dlTc2olAdPhlh9tkV1QK
EcI3Qu4H13zh/vO+AAaOssxzPPGxicVkMDP80Q5IJd/dr3OVJqJ+GUG6kKFX27E+
sxl5+exU+mrDsDp4PKJG0FQ8ERm7MML2wd324KECgYEA/3C5D1OZPp+7ac1yRRbf
okcw8N3ncHOsq2CALOuridCk7tKqWl/Gc6aWXF7RScxc+YM5g/YK+QeZkaRxgK3b
/iR5lSGcyrr/wtAKTN5vKC6dNipFel9BpJCzoO4Fy0iLrH6O3E1gyCyAN40Olw8I
VFxIe/Ovx22mzcd09vxGwBECgYEAyY3IX7KQh3+2ssMuI5II+/QrwIHwrisFdNFP
KQLxD5yAzzu0tzoLqSC6lOkl5aWthh2c936UGOYgUzpWC8hU9wD+TOwVj6rsTJeV
ssgeDXWhsEtMlatSRbrP4iDESjHRvwWtSFvMHqhNFI1vOeMxXweqesrIryXm9pJ+
GfF4XnUCgYEA5wiCKM2Y3h5EuPYbs0dz72dqaYCa0oedFcgLRhXFqblvY55ge6sC
aBm1B0ivDIttUDOS8rq3w/NOv363NgaJ4jwFR5AGKwqlRwM5Pbs1WGeIw7PJ8Vt0
mK5T+WsvDGTKB7LT7YeC0KoHMbdACfqLsxlgadPHGZ4gbyBGtxkHuLECgYATjbPA
xPwMiTFaSmExhjtk5h1QgcqtuvK+kIfTfLuSPiao9CvmErWK5Of1BmFs1BPvjPPr
dtY7TCgaqvAqGHdVtzz0jXrSA00FaTdWrt9rgtv61HNLmeFTbno4f+FLKWYl2BEl
kfJNjxpbQhVmUko54+6AFyg9BbpQdYnSToDU+QKBgQDf9rFhvPe3PJCNvTTQyem/
lF3rfYvqNeL6+jhKiSV1Wau6I/zg4717G4nenBX6lqFdrEmDdBpwfIYLfv44eJhh
DshEn0SfrDV2AoPqvysNZlP6Jeip89/1/2HsRl/EZg0AxYhIShhLYI7EgV7/Izoq
S5DeBWpxe8aNjQD9Z9trDw==
-----END PRIVATE KEY-----`;

export const SAML_TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIDGTCCAgGgAwIBAgIUeIQYfKmqHAjWggIssxOZ89Oe7v8wDQYJKoZIhvcNAQEL
BQAwHDEaMBgGA1UEAwwRZnNtLXNhbWwtdGVzdC1pZHAwHhcNMjYxMTA4MDI1NjMw
WhcNMzYxMTA1MDI1NjMwWjAcMRowGAYDVQQDDBFmc20tc2FtbC10ZXN0LWlkcDCC
ASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAMkc+lKDqZrbSHpNZyD18RBM
RnR8EVhrz9XDxsM5T6ARl/q+x6xTHV39OxoUWoLmnCBSdTXQsDdxFQMQMvzAj1XN
SacecSR9Q8qNRja4AZhHXgcG7N3sFmhTUlyB1dYatBf1lXVcAFgpudNkJZt9NXbL
vOd45/9a7lYIjP9qw4oeE+SfT8uric8hgk/gT7CAv5D5jajMsEXF4YCrYAQoaj0P
HQq600hLMbo1vkf4IhN7cDuM2fPDHjtaqenuLC8BX99MXe/vn0f1RVTJdgfLCSmt
u4h69QN8b4C1BxWY+RsFumIyOAFIjkon69edjkRQgttYQ4nCl3Tf9YMhJk/UBcUC
AwEAAaNTMFEwHQYDVR0OBBYEFGRWRgu3c0Fxee3CWFTpt4QCfhkFMB8GA1UdIwQY
MBaAFGRWRgu3c0Fxee3CWFTpt4QCfhkFMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZI
hvcNAQELBQADggEBAEJGSIK5tAca0fWqk4Qm4oasAM6YHEhrPx7NdfSTmZp6tjcm
XnH+eCpaQHGz6n5o3mQJPe7e3gkQ24PFYt/Qf/qFg+oiIz92Nz2+DCyWamWRrmS9
OFlqBmfRYW4YqJY4jgWj/iRDU4Z+auwrzSnIlLAm0qZ/gZpVFR1d3TqXE5CpguJI
tzuNXybyuNRyVDfiKQ+LymnMwEnXR8BgBz5Uy9sVDUyfSfH/Hwu159Imv//KKD8N
TBEctUexWb9aPd0j11GGVNTigN3fhtq6RxTxOxnwYr9Z7WdZW53WTJ7TJf7iWUU8
qQ1utk6/VEKlOujal6jC/2+DNOLhpVwPxyUGeAQ=
-----END CERTIFICATE-----`;

export const TEST_ACS_URL = "https://fsm.example/api/auth/saml/test/acs";
export const TEST_SP_ENTITY_ID =
  "https://fsm.example/api/auth/saml/test/metadata";
export const TEST_IDP_ENTITY_ID = "https://idp.example/metadata";

export function testSamlConfig(
  overrides: Partial<SamlProviderConfig> = {},
): SamlProviderConfig {
  return {
    slug: "test",
    id: "saml-test",
    displayName: "Test IdP",
    protocol: "saml",
    entryPoint: "https://idp.example/sso",
    metadataUrl: null,
    metadataXml: null,
    idpCert: SAML_TEST_CERT,
    idpIssuer: TEST_IDP_ENTITY_ID,
    spEntityId: TEST_SP_ENTITY_ID,
    acsUrl: TEST_ACS_URL,
    audience: TEST_SP_ENTITY_ID,
    wantAssertionsSigned: true,
    wantResponseSigned: false,
    signAuthnRequest: false,
    spPrivateKey: null,
    allowIdpInitiated: false,
    emailAttribute: "email",
    nameAttribute: "displayName",
    groupsAttribute: "groups",
    departmentAttribute: null,
    groupRoleMap: {},
    groupDepartmentMap: {},
    defaultRole: "USER",
    defaultDepartment: null,
    allowedEmailDomains: [],
    autoProvision: false,
    autoProvisionActive: false,
    syncRoles: false,
    syncDepartment: false,
    ...overrides,
  };
}

export type SamlResponseOptions = {
  requestId?: string;
  assertionId?: string;
  audience?: string;
  recipient?: string;
  email?: string;
  groups?: string[];
  name?: string;
  department?: string | null;
  notBefore?: Date;
  notOnOrAfter?: Date;
  issueInstant?: Date;
  includeInResponseTo?: boolean;
  includeSignature?: boolean;
};

/**
 * Bygger en SAML-respons med en signert assertion. Feltene kan endres før
 * signering, slik at testene kan lage gyldige og ugyldige varianter.
 */
export function buildSignedSamlResponse(
  options: SamlResponseOptions = {},
): string {
  const now = options.issueInstant ?? new Date();
  const notBefore = options.notBefore ?? new Date(now.getTime() - 60_000);
  const notOnOrAfter =
    options.notOnOrAfter ?? new Date(now.getTime() + 5 * 60_000);
  const requestId = options.requestId ?? "_request-1";
  const assertionId = options.assertionId ?? "_assertion-1";
  const audience = options.audience ?? TEST_SP_ENTITY_ID;
  const recipient = options.recipient ?? TEST_ACS_URL;
  const issue = now.toISOString();
  const groups = (options.groups ?? ["FSM-Office"])
    .map(
      (group) =>
        `<saml:AttributeValue>${escapeXml(group)}</saml:AttributeValue>`,
    )
    .join("");

  const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_response-1" Version="2.0" IssueInstant="${issue}" Destination="${escapeXml(
    recipient,
  )}"${
    options.includeInResponseTo === false ? "" : ` InResponseTo="${requestId}"`
  }>
<saml:Issuer>${TEST_IDP_ENTITY_ID}</saml:Issuer>
<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
<saml:Assertion ID="${assertionId}" Version="2.0" IssueInstant="${issue}">
<saml:Issuer>${TEST_IDP_ENTITY_ID}</saml:Issuer>
<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified">subject-1</saml:NameID>
<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${notOnOrAfter.toISOString()}" Recipient="${escapeXml(
    recipient,
  )}" InResponseTo="${requestId}"/></saml:SubjectConfirmation></saml:Subject>
<saml:Conditions NotBefore="${notBefore.toISOString()}" NotOnOrAfter="${notOnOrAfter.toISOString()}"><saml:AudienceRestriction><saml:Audience>${escapeXml(
    audience,
  )}</saml:Audience></saml:AudienceRestriction></saml:Conditions>
<saml:AuthnStatement AuthnInstant="${issue}" SessionIndex="_session-1"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>
<saml:AttributeStatement><saml:Attribute Name="email"><saml:AttributeValue>${escapeXml(
    options.email ?? "kari@example.no",
  )}</saml:AttributeValue></saml:Attribute><saml:Attribute Name="displayName"><saml:AttributeValue>${escapeXml(
    options.name ?? "Kari Test",
  )}</saml:AttributeValue></saml:Attribute><saml:Attribute Name="groups">${groups}</saml:Attribute>${
    options.department === null || options.department === undefined
      ? ""
      : `<saml:Attribute Name="department"><saml:AttributeValue>${escapeXml(
          options.department,
        )}</saml:AttributeValue></saml:Attribute>`
  }</saml:AttributeStatement>
</saml:Assertion></samlp:Response>`;

  if (options.includeSignature === false) return xml;

  const signer = new SignedXml({
    privateKey: SAML_TEST_PRIVATE_KEY,
    publicCert: SAML_TEST_CERT,
    signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
  });
  signer.addReference({
    xpath: "//*[local-name()='Assertion']",
    uri: `#${assertionId}`,
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/2001/10/xml-exc-c14n#",
    ],
  });
  signer.computeSignature(xml, {
    location: {
      reference:
        "//*[local-name()='Issuer'][parent::*[local-name()='Assertion']]",
      action: "after",
    },
  });
  return signer.getSignedXml();
}

export function samlResponseBase64(xml: string): string {
  return Buffer.from(xml, "utf8").toString("base64");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
