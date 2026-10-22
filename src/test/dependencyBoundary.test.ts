import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const SRC = join(process.cwd(), 'src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function listDir(sub: string): string[] {
  return sourceFiles(join(SRC, sub)).map((f) => f.replace(SRC + sep, ''));
}

function readSource(relative: string): string {
  return readFileSync(join(SRC, relative), 'utf8');
}

/**
 * The source with comments and string literals removed, so a structural assertion
 * cannot be fooled by prose. A module that documents "no retry" in a comment must
 * not fail a check that forbids a retry loop, and a secret name mentioned in a
 * comment explaining why it is unused is not an access.
 */
function readCode(relative: string): string {
  return readSource(relative)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

const COMPONENTS = listDir('components');
const SERVICES = listDir('services');

const FIREBASE_IMPORT = /from\s+['"]firebase\//;

const SERVER_BOUNDARY_PREFIX = 'services/serverBoundary/';

/**
 * The STEP 67 execution modules, optionally narrowed to a `prefix`.
 *
 * The `Capability` modules added in STEP 68 also begin with `serverExecution`, so
 * a bare prefix match would silently fold the read-only capability boundary into
 * the execution boundary's guard set. Excluding it here keeps the two boundaries
 * independently assertable - which is the whole reason the guards exist.
 */
function executionBoundaryFiles(prefix: string): string[] {
  return listDir('services/serverBoundary')
    .map((f) => f.split('\\').join('/'))
    .filter(
      (f) =>
        f.startsWith(SERVER_BOUNDARY_PREFIX + prefix) &&
        !f.startsWith(SERVER_BOUNDARY_PREFIX + prefix + 'Capability')
    )
    .sort();
}

/** The STEP 68 read-only capability modules. */
function capabilityBoundaryFiles(): string[] {
  return listDir('services/serverBoundary')
    .map((f) => f.split('\\').join('/'))
    .filter((f) => f.startsWith(SERVER_BOUNDARY_PREFIX + 'serverExecutionCapability'))
    .sort();
}

/**
 * The declared field names of an exported interface, with `?` marking optionals.
 *
 * Used instead of a substring scan so a guard on the *wire shape* is not defeated
 * by the word appearing in a doc comment, and so adding a field to a response
 * contract is a test failure rather than a silent expansion of what the browser
 * may receive.
 */
function interfaceFields(source: string, name: string): string[] {
  const match = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(source);
  if (match === null) throw new Error(`interface ${name} not found`);
  return [...match[1].matchAll(/^ {2}(\w+)(\?)?:/gm)].map((m) => m[1] + (m[2] === '?' ? '?' : ''));
}

describe('dependency boundaries', () => {
  it('components must not import the Firebase SDK directly', () => {
    const violators = COMPONENTS.filter((file) => FIREBASE_IMPORT.test(readSource(file)));
    expect(violators).toEqual([]);
  });

  it('services must not depend on React/ReactDOM (UI independence)', () => {
    const reactImport = /from\s+['"]react(?:-dom)?['"]/;
    const violators = SERVICES.filter((file) => reactImport.test(readSource(file)));
    expect(violators).toEqual([]);
  });

  it('aiPlanningService must stay a proposal-only assistant (AI never persists)', () => {
    const source = readSource('services/aiPlanningService.ts');

    const firestoreImport = /from\s+['"]firebase\/firestore['"]/;
    expect(firestoreImport.test(source)).toBe(false);

    const tripServiceImport = /from\s+['"]\.\/tripService['"]/;
    expect(tripServiceImport.test(source)).toBe(false);

    const agentImport = /from\s+['"]\.\/aiTravelAgent['"]/;
    expect(agentImport.test(source)).toBe(false);

    expect(source).not.toMatch(/updateTripPlanning\s*\(/);
    expect(source).not.toMatch(/setDoc|addDoc|updateDoc|deleteDoc|runTransaction/);
  });

  it('PlanningEditor must not persist AI suggestions itself (approval boundary)', () => {
    const source = readSource('components/trips/PlanningEditor.tsx');

    expect(source).not.toMatch(/updateTripPlanning/);
    expect(source).not.toMatch(/import\s+.*\btripService\b/);
  });

  it('verificationState must stay provider- and checklist-free domain vocabulary', () => {
    const source = readSource('domain/trips/verificationState.ts');

    expect(source).not.toMatch(/from\s+['"].*executionChecklist['"]/);
    expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
    expect(source).not.toMatch(FIREBASE_IMPORT);
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/axios|stripe|provider-api/);
  });

  it('provider domain modules must stay pure and SDK/Firebase/UI-free (STEP 20 boundary)', () => {
    const providerFiles = listDir('domain/providers').map((f) => f.split('\\').join('/'));
    expect(providerFiles.length).toBe(9);
    expect(providerFiles).toEqual([
      'domain/providers/bookingLifecycle.ts',
      'domain/providers/discoveryInput.ts',
      'domain/providers/discoveryOrchestration.ts',
      'domain/providers/executionApprovalAudit.ts',
      'domain/providers/executionOperations.ts',
      'domain/providers/providerAdapter.ts',
      'domain/providers/providerCapabilities.ts',
      'domain/providers/providerResults.ts',
      'domain/providers/verificationProducer.ts',
    ]);

    for (const file of providerFiles) {
      const source = readSource(file);
      expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
      expect(source).not.toMatch(/from\s+['"]react-router-?dom?['"]/);
      expect(source).not.toMatch(/from\s+['"]zustand['"]/);
      expect(source).not.toMatch(FIREBASE_IMPORT);
      expect(source).not.toMatch(/from\s+['"]\.\.\/\.\.\/services\//);
      expect(source).not.toMatch(/from\s+['"]\.\.\/\.\.\/components\//);
      expect(source).not.toMatch(/fetch\s*\(/);
      expect(source).not.toMatch(/axios|stripe|provider-api|@google-cloud/);
      expect(source).not.toMatch(/process\.env/);
    }
  });

  it('provider domain modules never import each other across the boundary in a cycle-forming way', () => {
    const source = readSource('domain/providers/verificationProducer.ts');
    // verificationProducer may import the pure STEP 19 verification vocabulary,
    // but never the planning service, execution checklist, or app services.
    expect(source).not.toMatch(/from\s+['"].*executionChecklist['"]/);
    expect(source).not.toMatch(/from\s+['"]\.\.\/\.\.\/services\//);
  });

  it('bookingLifecycle stays decoupled from the producer vocabulary', () => {
    const source = readSource('domain/providers/bookingLifecycle.ts');
    expect(source).not.toMatch(/from\s+['"].*verificationProducer['"]/);
    expect(source).not.toMatch(/from\s+['"].*executionChecklist['"]/);
  });

  it('mock discovery modules must be deterministic, network/SDK/Firebase/UI-free (STEP 21 boundary)', () => {
    const files = listDir('services/mockDiscovery').map((f) => f.split('\\').join('/'));
    expect(files.length).toBe(6);
    expect(files).toEqual([
      'services/mockDiscovery/mockAccommodationProvider.ts',
      'services/mockDiscovery/mockAlternativeTransportProvider.ts',
      'services/mockDiscovery/mockDiscoveryService.ts',
      'services/mockDiscovery/mockFixtures.ts',
      'services/mockDiscovery/mockProviders.ts',
      'services/mockDiscovery/mockTransportProvider.ts',
    ]);

    for (const file of files) {
      const source = readSource(file);
      expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
      expect(source).not.toMatch(/from\s+['"]react-router-?dom?['"]/);
      expect(source).not.toMatch(/from\s+['"]zustand['"]/);
      expect(source).not.toMatch(FIREBASE_IMPORT);
      expect(source).not.toMatch(/fetch\s*\(/);
      expect(source).not.toMatch(/axios|stripe|provider-api|@google-cloud/);
      expect(source).not.toMatch(/process\.env/);
    }
  });

  it('mock discovery must have no current-clock access (determinism given `now`)', () => {
    const files = listDir('services/mockDiscovery').map((f) => f.split('\\').join('/'));
    for (const file of files) {
      const source = readSource(file);
      expect(source).not.toMatch(/\bDate\.now\(/);
      expect(source).not.toMatch(/new\s+Date\(\s*\)/);
    }
  });

  it('mock discovery must never persist, mutate a trip, or touch Firestore (STEP 21 boundary)', () => {
    const files = listDir('services/mockDiscovery').map((f) => f.split('\\').join('/'));
    for (const file of files) {
      const source = readSource(file);
      expect(source).not.toMatch(/from\s+['"].*tripService['"]/);
      expect(source).not.toMatch(/from\s+['"].*firestoreService['"]/);
      expect(source).not.toMatch(/from\s+['"].*dataConnectService['"]/);
      expect(source).not.toMatch(/updateTripPlanning\s*\(/);
      expect(source).not.toMatch(/setDoc|addDoc|updateDoc|deleteDoc|runTransaction/);
    }
  });

  it('discovery stays read-only: no booking/payment/ticket/cancellation execution vocabulary runs in mock discovery', () => {
    const files = listDir('services/mockDiscovery').map((f) => f.split('\\').join('/'));
    for (const file of files) {
      const source = readSource(file);
      expect(source).not.toMatch(/submit-booking|cancel-booking|prepare-booking/);
      expect(source).not.toMatch(/charge|payment-intent|paid|invoice/);
    }
  });

  it('real discovery modules must be deterministic, secret-free, SDK/Firebase/UI-free (STEP 41 boundary)', () => {
    const files = listDir('services/realDiscovery').map((f) => f.split('\\').join('/'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readSource(file);
      expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
      expect(source).not.toMatch(/from\s+['"]react-router-?dom?['"]/);
      expect(source).not.toMatch(/from\s+['"]zustand['"]/);
      expect(source).not.toMatch(FIREBASE_IMPORT);
      expect(source).not.toMatch(/import\.meta\.env/);
      expect(source).not.toMatch(/process\.env/);
      expect(source).not.toMatch(/axios|stripe|provider-api|@google-cloud/);
      expect(source).not.toMatch(/\bDate\.now\(/);
      expect(source).not.toMatch(/new\s+Date\(\s*\)/);
      expect(source).not.toMatch(/\bMath\.random\b/);
    }
  });

  it('real discovery is a read-only provider seam: no persistence, trip, or Firestore access (STEP 41 boundary)', () => {
    const files = listDir('services/realDiscovery').map((f) => f.split('\\').join('/'));
    for (const file of files) {
      const source = readSource(file);
      expect(source).not.toMatch(/from\s+['"].*tripService['"]/);
      expect(source).not.toMatch(/from\s+['"].*firestoreService['"]/);
      expect(source).not.toMatch(/from\s+['"].*dataConnectService['"]/);
      expect(source).not.toMatch(/updateTripPlanning\s*\(/);
      expect(source).not.toMatch(/setDoc|addDoc|updateDoc|deleteDoc|runTransaction/);
    }
  });

  it('real discovery stays read-only: no booking/payment/ticket vocabulary runs in the provider seam (STEP 41 boundary)', () => {
    const files = listDir('services/realDiscovery').map((f) => f.split('\\').join('/'));
    for (const file of files) {
      const source = readSource(file);
      expect(source).not.toMatch(/submit-booking|cancel-booking|prepare-booking/);
      expect(source).not.toMatch(/charge|payment-intent|paid|invoice/);
    }
  });

  it('real execution is exactly the five documented provider modules (STEP 66 boundary)', () => {
    const files = listDir('services/realExecution').map((f) => f.split('\\').join('/')).sort();
    expect(files).toEqual([
      'services/realExecution/amadeusExecutionAdapter.ts',
      'services/realExecution/amadeusExecutionConfig.ts',
      'services/realExecution/amadeusExecutionConnection.ts',
      'services/realExecution/amadeusExecutionMapping.ts',
      'services/realExecution/realExecutionService.ts',
    ]);
  });

  it('real execution modules must be deterministic, secret-free, SDK/Firebase/UI-free (STEP 66 boundary)', () => {
    const files = listDir('services/realExecution').map((f) => f.split('\\').join('/'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readSource(file);
      expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
      expect(source).not.toMatch(/from\s+['"]react-router-?dom?['"]/);
      expect(source).not.toMatch(/from\s+['"]zustand['"]/);
      expect(source).not.toMatch(FIREBASE_IMPORT);
      expect(source).not.toMatch(/import\.meta\.env/);
      expect(source).not.toMatch(/process\.env/);
      expect(source).not.toMatch(/axios|stripe|provider-api|@google-cloud/);
      expect(source).not.toMatch(/\bDate\.now\(/);
      expect(source).not.toMatch(/new\s+Date\(\s*\)/);
      expect(source).not.toMatch(/\bMath\.random\b/);
    }
  });

  it('real execution reads no environment directly and honors no browser-exposed secret (STEP 66 boundary)', () => {
    const files = listDir('services/realExecution').map((f) => f.split('\\').join('/'));
    for (const file of files) {
      const source = readSource(file);
      // The only env-shaped reader takes an injected string map, so no module can
      // reach a real environment, and a VITE_-prefixed key can never be honored.
      expect(source).not.toMatch(/import\.meta\.env/);
      expect(source).not.toMatch(/process\.env/);
      expect(source).not.toMatch(/Deno\.env|Bun\.env/);
    }
  });

  it('real execution stays a closed seam: no booking/payment/ticket/cancellation vocabulary and no direct fetch call (STEP 66 boundary)', () => {
    const files = listDir('services/realExecution').map((f) => f.split('\\').join('/'));
    for (const file of files) {
      const source = readSource(file);
      expect(source).not.toMatch(/submit-booking|cancel-booking|prepare-booking/);
      expect(source).not.toMatch(/charge|payment-intent|paid|invoice/);
      // A provider seam must never call the network directly: the injectable
      // transport is the only outbound edge, and it is never invoked by default.
      expect(source).not.toMatch(/await\s+fetch\s*\(/);
    }
  });

  it('discovery-to-planning handoff lives in exactly one pure domain module (STEP 22 boundary)', () => {
    const files = listDir('domain/discovery').map((f) => f.split('\\').join('/'));
    expect(files).toEqual(['domain/discovery/handoff.ts']);

    for (const file of files) {
      const source = readSource(file);
      expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
      expect(source).not.toMatch(/from\s+['"]react-router-?dom?['"]/);
      expect(source).not.toMatch(/from\s+['"]zustand['"]/);
      expect(source).not.toMatch(FIREBASE_IMPORT);
      expect(source).not.toMatch(/from\s+['"]\.\.\/\.\.\/services\//);
      expect(source).not.toMatch(/from\s+['"]\.\.\/\.\.\/components\//);
      expect(source).not.toMatch(/fetch\s*\(/);
      expect(source).not.toMatch(/axios|stripe|provider-api|@google-cloud/);
      expect(source).not.toMatch(/process\.env/);
    }
  });

  it('handoff domain module has no current-clock access (deterministic given `now`)', () => {
    const source = readSource('domain/discovery/handoff.ts');
    expect(source).not.toMatch(/\bDate\.now\(/);
    expect(source).not.toMatch(/new\s+Date\(\s*\)/);
    expect(source).not.toMatch(/\bDate\b/);
  });

  it('handoff domain module must never persist, mutate a trip, or touch Firestore (STEP 22 boundary)', () => {
    const source = readSource('domain/discovery/handoff.ts');
    expect(source).not.toMatch(/from\s+['"].*tripService['"]/);
    expect(source).not.toMatch(/from\s+['"].*firestoreService['"]/);
    expect(source).not.toMatch(/from\s+['"].*dataConnectService['"]/);
    expect(source).not.toMatch(/updateTripPlanning\s*\(/);
    expect(source).not.toMatch(/setDoc|addDoc|updateDoc|deleteDoc|runTransaction/);
  });

  it('handoff stays planning-data-only: no booking/payment/ticket vocabulary (STEP 22 boundary)', () => {
    const source = readSource('domain/discovery/handoff.ts');
    expect(source).not.toMatch(/submit-booking|cancel-booking|prepare-booking/);
    expect(source).not.toMatch(/charge|payment-intent|paid|invoice/);
  });

  it('planningProvenance stays pure and SDK/Firebase/UI/network-free (STEP 23 boundary)', () => {
    const source = readSource('domain/trips/planningProvenance.ts');
    expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
    expect(source).not.toMatch(/from\s+['"]react-router-?dom?['"]/);
    expect(source).not.toMatch(/from\s+['"]zustand['"]/);
    expect(source).not.toMatch(FIREBASE_IMPORT);
    expect(source).not.toMatch(/from\s+['"]\.\.\/\.\.\/services\//);
    expect(source).not.toMatch(/from\s+['"]\.\.\/\.\.\/components\//);
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/axios|stripe|provider-api|@google-cloud/);
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/\bDate\.now\(/);
    expect(source).not.toMatch(/new\s+Date\(\s*\)/);
    expect(source).not.toMatch(/\bDate\b/);
  });

  it('planningProvenance stays an honest reference label: no booking/payment vocabulary (STEP 23 boundary)', () => {
    const source = readSource('domain/trips/planningProvenance.ts');
    expect(source).not.toMatch(/submit-booking|cancel-booking|prepare-booking/);
    expect(source).not.toMatch(/charge|payment-intent|paid|invoice/);
    expect(source).not.toMatch(
      /currently available|guaranteed availability|confirmed availability/
    );
  });

  it('planningLifecycle stays pure and SDK/Firebase/UI/network/clock-free (STEP 24 boundary)', () => {
    const source = readSource('domain/trips/planningLifecycle.ts');
    expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
    expect(source).not.toMatch(/from\s+['"]react-router-?dom?['"]/);
    expect(source).not.toMatch(/from\s+['"]zustand['"]/);
    expect(source).not.toMatch(FIREBASE_IMPORT);
    expect(source).not.toMatch(/from\s+['"]\.\.\/\.\.\/services\//);
    expect(source).not.toMatch(/from\s+['"]\.\.\/\.\.\/components\//);
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/axios|stripe|provider-api|@google-cloud/);
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/\bDate\.now\(/);
    expect(source).not.toMatch(/new\s+Date\(\s*\)/);
    expect(source).not.toMatch(/\bDate\b/);
    expect(source).not.toMatch(/\bTODO\b|FIXME|setTimeout|setInterval/);
  });

  it('planningLifecycle has no staleness machinery and no freshness claims (STEP 24 boundary)', () => {
    const source = readSource('domain/trips/planningLifecycle.ts');
    expect(source).not.toMatch(/setInterval|setTimeout/);
    expect(source).not.toMatch(/expiresAt|checkedAt|verifiedAt|freshnessTimestamp|lastChecked/);
    expect(source).not.toMatch(
      /currently available|guaranteed availability|confirmed availability/
    );
    expect(source).not.toMatch(/submit-booking|cancel-booking|prepare-booking/);
    expect(source).not.toMatch(/charge|payment-intent|paid|invoice/);
  });

  it('the lifecycle vocabulary is never inferred from provenance or readiness (STEP 24 boundary)', () => {
    const source = readSource('domain/trips/planningLifecycle.ts');
    expect(source).not.toMatch(/from\s+['"].*planningProvenance['"]/);
    expect(source).not.toMatch(/from\s+['"].*executionReadiness['"]/);
    expect(source).not.toMatch(/from\s+['"].*tripPlanningEdit['"]/);
  });

  it('planningReferenceProjection stays pure and SDK/Firebase/UI/network/clock-free (STEP 25 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceProjection.ts');
    expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
    expect(source).not.toMatch(/from\s+['"]react-router-?dom?['"]/);
    expect(source).not.toMatch(/from\s+['"]zustand['"]/);
    expect(source).not.toMatch(FIREBASE_IMPORT);
    expect(source).not.toMatch(/from\s+['"]\.\.\/\.\.\/services\//);
    expect(source).not.toMatch(/from\s+['"]\.\.\/\.\.\/components\//);
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/axios|stripe|provider-api|@google-cloud/);
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/\bDate\.now\(/);
    expect(source).not.toMatch(/new\s+Date\(\s*\)/);
    expect(source).not.toMatch(/\bDate\b/);
    expect(source).not.toMatch(/\bTODO\b|FIXME|setTimeout|setInterval/);
  });

  it('planningReferenceProjection has no staleness machinery and no freshness claims (STEP 25 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceProjection.ts');
    expect(source).not.toMatch(/setInterval|setTimeout/);
    expect(source).not.toMatch(/expiresAt|checkedAt|verifiedAt|freshnessTimestamp|lastChecked/);
    expect(source).not.toMatch(
      /currently available|guaranteed availability|confirmed availability/
    );
    expect(source).not.toMatch(/submit-booking|cancel-booking|prepare-booking/);
    expect(source).not.toMatch(/charge|payment-intent|paid|invoice/);
  });

  it('planningReferenceProjection is a read-only projection: no persistence, mutation, or edit plumbing (STEP 25 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceProjection.ts');
    expect(source).not.toMatch(/from\s+['"]\.\.\/\.\.\/services\//);
    expect(source).not.toMatch(/updateTripPlanning\s*\(/);
    expect(source).not.toMatch(/setDoc|addDoc|updateDoc|deleteDoc|runTransaction/);
    expect(source).not.toMatch(/from\s+['"].*tripPlanningEdit['"]/);
  });

  it('the projection respects the lifecycle one-directional rule and never duplicates vocabulary (STEP 25 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceProjection.ts');
    expect(source).toMatch(/from\s+['"].*planningLifecycle['"]/);
    expect(source).not.toMatch(/from\s+['"].*planningProvenance['"]/);
    expect(source).not.toMatch(/from\s+['"].*executionReadiness['"]/);
    expect(source).not.toMatch(/from\s+['"].*tripPlanningEdit['"]/);
  });

  it('planningReferenceSelection stays pure and SDK/Firebase/UI/network/clock-free (STEP 26 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceSelection.ts');
    expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
    expect(source).not.toMatch(/from\s+['"]react-router-?dom?['"]/);
    expect(source).not.toMatch(/from\s+['"]zustand['"]/);
    expect(source).not.toMatch(FIREBASE_IMPORT);
    expect(source).not.toMatch(/from\s+['"]\.\.\/\.\.\/services\//);
    expect(source).not.toMatch(/from\s+['"]\.\.\/\.\.\/components\//);
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/axios|stripe|provider-api|@google-cloud/);
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/\bDate\.now\(/);
    expect(source).not.toMatch(/new\s+Date\(\s*\)/);
    expect(source).not.toMatch(/\bDate\b/);
    expect(source).not.toMatch(/\bTODO\b|FIXME|setTimeout|setInterval/);
  });

  it('planningReferenceSelection has no staleness machinery and no freshness claims (STEP 26 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceSelection.ts');
    expect(source).not.toMatch(/setInterval|setTimeout/);
    expect(source).not.toMatch(/expiresAt|checkedAt|verifiedAt|freshnessTimestamp|lastChecked/);
    expect(source).not.toMatch(
      /currently available|guaranteed availability|confirmed availability/
    );
    expect(source).not.toMatch(/submit-booking|cancel-booking|prepare-booking/);
    expect(source).not.toMatch(/charge|payment-intent|paid|invoice/);
  });

  it('planningReferenceSelection is a read-only selection projection: no persistence or mutation (STEP 26 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceSelection.ts');
    expect(source).not.toMatch(/from\s+['"]\.\.\/\.\.\/services\//);
    expect(source).not.toMatch(/updateTripPlanning\s*\(/);
    expect(source).not.toMatch(/setDoc|addDoc|updateDoc|deleteDoc|runTransaction/);
    expect(source).not.toMatch(/from\s+['"].*tripPlanningEdit['"]/);
    expect(source).not.toMatch(/\bDate\b/);
  });

  it('planningReferenceSelection composes with planningLifecycle and planningReferenceProjection only (STEP 26 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceSelection.ts');
    expect(source).toMatch(/from\s+['"].*planningLifecycle['"]/);
    expect(source).toMatch(/from\s+['"].*planningReferenceProjection['"]/);
    expect(source).not.toMatch(/from\s+['"].*planningProvenance['"]/);
    expect(source).not.toMatch(/from\s+['"].*executionReadiness['"]/);
    expect(source).not.toMatch(/from\s+['"].*tripPlanning['"]/);
  });

  it('planningReferenceSelection never auto-selects or auto-promotes (STEP 26 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceSelection.ts');
    // The module is a read-time resolution model: no identifier exists that
    // auto-assigns, defaults, or promotes a primary id on the owner's behalf.
    expect(source).not.toMatch(/autoPrimary|defaultPrimary|selectDefault|assignPrimary/);
    expect(source).not.toMatch(/selectedId\s*=\s*['"]/);
    expect(source).not.toMatch(/setInterval|setTimeout|Date\.now/);
  });

  it('planningReferenceSelection never modifies, mutates, or persists the primary ids (STEP 26 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceSelection.ts');
    expect(source).not.toMatch(/primaryTransportPlanId\s*=/);
    expect(source).not.toMatch(/primaryAccommodationPlanId\s*=/);
    expect(source).not.toMatch(/\.primaryTransportPlanId/);
    expect(source).not.toMatch(/\.primaryAccommodationPlanId/);
  });

  it('planningReferenceConflict stays pure and SDK/Firebase/UI/network/clock-free (STEP 27 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceConflict.ts');
    expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
    expect(source).not.toMatch(/from\s+['"]react-router-?dom?['"]/);
    expect(source).not.toMatch(/from\s+['"]zustand['"]/);
    expect(source).not.toMatch(FIREBASE_IMPORT);
    expect(source).not.toMatch(/from\s+['"]\.\.\/\.\.\/services\//);
    expect(source).not.toMatch(/from\s+['"]\.\.\/\.\.\/components\//);
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/axios|stripe|provider-api|@google-cloud/);
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/\bDate\.now\(/);
    expect(source).not.toMatch(/new\s+Date\(\s*\)/);
    expect(source).not.toMatch(/\bDate\b/);
    expect(source).not.toMatch(/\bTODO\b|FIXME|setTimeout|setInterval/);
  });

  it('planningReferenceConflict has no staleness machinery and no freshness claims (STEP 27 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceConflict.ts');
    expect(source).not.toMatch(/setInterval|setTimeout/);
    expect(source).not.toMatch(/expiresAt|checkedAt|verifiedAt|freshnessTimestamp|lastChecked/);
    expect(source).not.toMatch(
      /currently available|guaranteed availability|confirmed availability/
    );
    expect(source).not.toMatch(/submit-booking|cancel-booking|prepare-booking/);
    expect(source).not.toMatch(/charge|payment-intent|paid|invoice/);
  });

  it('planningReferenceConflict is conflict guidance only: no persistence, mutation, or edit plumbing (STEP 27 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceConflict.ts');
    expect(source).not.toMatch(/from\s+['"]\.\.\/\.\.\/services\//);
    expect(source).not.toMatch(/updateTripPlanning\s*\(/);
    expect(source).not.toMatch(/setDoc|addDoc|updateDoc|deleteDoc|runTransaction/);
    expect(source).not.toMatch(/from\s+['"].*tripPlanningEdit['"]/);
  });

  it('planningReferenceConflict composes with lifecycle, projection, and selection only (STEP 27 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceConflict.ts');
    expect(source).toMatch(/from\s+['"].*planningLifecycle['"]/);
    expect(source).toMatch(/from\s+['"].*planningReferenceProjection['"]/);
    expect(source).toMatch(/from\s+['"].*planningReferenceSelection['"]/);
    expect(source).not.toMatch(/from\s+['"].*planningProvenance['"]/);
    expect(source).not.toMatch(/from\s+['"].*executionReadiness['"]/);
    expect(source).not.toMatch(/from\s+['"].*tripPlanning['"]/);
  });

  it('planningReferenceConflict resolves conflicts, never resolves the selection for the user (STEP 27 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceConflict.ts');
    expect(source).not.toMatch(/autoPrimary|defaultPrimary|selectDefault|assignPrimary/);
    expect(source).not.toMatch(/selectedId\s*=\s*['"]/);
    expect(source).not.toMatch(/setInterval|setTimeout|Date\.now/);
  });

  it('planningReferenceConflict reads stored primary ids for reporting but never writes them (STEP 27 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceConflict.ts');
    expect(source).toMatch(/planning\.primaryTransportPlanId/);
    expect(source).toMatch(/planning\.primaryAccommodationPlanId/);
    expect(source).not.toMatch(/primaryTransportPlanId\s*=/);
    expect(source).not.toMatch(/primaryAccommodationPlanId\s*=/);
  });

  it('planningReferenceResolution stays pure and SDK/Firebase/UI/network/clock-free (STEP 28 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceResolution.ts');
    expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
    expect(source).not.toMatch(/from\s+['"]react-router-?dom?['"]/);
    expect(source).not.toMatch(/from\s+['"]zustand['"]/);
    expect(source).not.toMatch(FIREBASE_IMPORT);
    expect(source).not.toMatch(/from\s+['"]\.\.\/\.\.\/services\//);
    expect(source).not.toMatch(/from\s+['"]\.\.\/\.\.\/components\//);
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/axios|stripe|provider-api|@google-cloud/);
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/\bDate\.now\(/);
    expect(source).not.toMatch(/new\s+Date\(\s*\)/);
    expect(source).not.toMatch(/\bDate\b/);
    expect(source).not.toMatch(/\bTODO\b|FIXME|setTimeout|setInterval/);
  });

  it('planningReferenceResolution has no staleness machinery and no freshness claims (STEP 28 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceResolution.ts');
    expect(source).not.toMatch(/setInterval|setTimeout/);
    expect(source).not.toMatch(/expiresAt|checkedAt|verifiedAt|freshnessTimestamp|lastChecked/);
    expect(source).not.toMatch(
      /currently available|guaranteed availability|confirmed availability/
    );
    expect(source).not.toMatch(/submit-booking|cancel-booking|prepare-booking/);
    expect(source).not.toMatch(/charge|payment-intent|paid|invoice/);
  });

  it('planningReferenceResolution is transient conflict-resolution vocabulary: no persistence or mutation (STEP 28 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceResolution.ts');
    expect(source).not.toMatch(/from\s+['"]\.\.\/\.\.\/services\//);
    expect(source).not.toMatch(/updateTripPlanning\s*\(/);
    expect(source).not.toMatch(/setDoc|addDoc|updateDoc|deleteDoc|runTransaction/);
    expect(source).not.toMatch(/from\s+['"].*tripPlanningEdit['"]/);
  });

  it('planningReferenceResolution composes with planningReferenceConflict (type), planningReferenceSelection, and the lifecycle model only (STEP 28 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceResolution.ts');
    expect(source).toMatch(/from\s+['"].*planningReferenceConflict['"]/);
    expect(source).toMatch(/from\s+['"].*planningReferenceSelection['"]/);
    expect(source).not.toMatch(/from\s+['"].*planningLifecycle['"]/);
    expect(source).not.toMatch(/from\s+['"].*planningProvenance['"]/);
    expect(source).not.toMatch(/from\s+['"].*planningReferenceProjection['"]/);
    expect(source).not.toMatch(/from\s+['"].*executionReadiness['"]/);
    expect(source).not.toMatch(/from\s+['"].*tripPlanning['"]/);
    expect(source).not.toMatch(/from\s+['"].*tripPlanningProposal['"]/);
  });

  it('planningReferenceResolution never auto-resolves or auto-selects for the user (STEP 28 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceResolution.ts');
    expect(source).not.toMatch(/autoPrimary|defaultPrimary|selectDefault|assignPrimary/);
    expect(source).not.toMatch(/selectedId\s*=\s*['"]/);
    expect(source).not.toMatch(/primaryTransportPlanId\s*=\s*['"]/);
    expect(source).not.toMatch(/primaryAccommodationPlanId\s*=\s*['"]/);
    expect(source).not.toMatch(/setInterval|setTimeout|Date\.now/);
  });

  it('planningReferenceResolution labels never claim booking, payment, or verification (STEP 28 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceResolution.ts');
    const bookingRuntimeTokens =
      /submit-booking|cancel-booking|prepare-booking|payment-intent|paid|invoice|charged/;
    expect(bookingRuntimeTokens.test(source)).toBe(false);
    const labelsMatch = source.match(/const DECISION_LABELS[\s\S]*?^};/m);
    const descriptionsMatch = source.match(/const DECISION_DESCRIPTIONS[\s\S]*?^};/m);
    expect(labelsMatch).not.toBeNull();
    expect(descriptionsMatch).not.toBeNull();
    const labelsBlock = labelsMatch![0];
    const descriptionsBlock = descriptionsMatch![0];
    const bookingWord =
      /\bbooked\b|\bbooking\b|\bpaid\b|\bcharged\b|\bverified\b|\breserved\b|\bcancelled\b|\bticket\b/i;
    expect(labelsBlock).not.toMatch(bookingWord);
    expect(descriptionsBlock).not.toMatch(bookingWord);
  });

  it('planningReferenceChangeContext stays pure and SDK/Firebase/UI/network/clock-free (STEP 29 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceChangeContext.ts');
    expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
    expect(source).not.toMatch(/from\s+['"]react-router-?dom?['"]/);
    expect(source).not.toMatch(/from\s+['"]zustand['"]/);
    expect(source).not.toMatch(FIREBASE_IMPORT);
    expect(source).not.toMatch(/from\s+['"]\.\.\/\.\.\/services\//);
    expect(source).not.toMatch(/from\s+['"]\.\.\/\.\.\/components\//);
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/axios|stripe|provider-api|@google-cloud/);
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/\bDate\.now\(/);
    expect(source).not.toMatch(/new\s+Date\(\s*\)/);
    expect(source).not.toMatch(/\bDate\b/);
    expect(source).not.toMatch(/\bTODO\b|FIXME|setTimeout|setInterval/);
  });

  it('planningReferenceChangeContext has no staleness machinery and no freshness claims (STEP 29 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceChangeContext.ts');
    expect(source).not.toMatch(/setInterval|setTimeout/);
    expect(source).not.toMatch(/expiresAt|checkedAt|verifiedAt|freshnessTimestamp|lastChecked/);
    expect(source).not.toMatch(
      /currently available|guaranteed availability|confirmed availability/
    );
    expect(source).not.toMatch(/submit-booking|cancel-booking|prepare-booking/);
    expect(source).not.toMatch(/charge|payment-intent|paid|invoice/);
  });

  it('planningReferenceChangeContext is transient read-time vocabulary: no persistence, mutation, or edit plumbing (STEP 29 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceChangeContext.ts');
    expect(source).not.toMatch(/from\s+['"]\.\.\/\.\.\/services\//);
    expect(source).not.toMatch(/updateTripPlanning\s*\(/);
    expect(source).not.toMatch(/setDoc|addDoc|updateDoc|deleteDoc|runTransaction/);
    expect(source).not.toMatch(/from\s+['"].*tripPlanningEdit['"]/);
    expect(source).not.toMatch(/from\s+['"].*tripPlanningProposal['"]/);
  });

  it('planningReferenceChangeContext composes with lifecycle, provenance, and conflict vocabulary only (STEP 29 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceChangeContext.ts');
    expect(source).toMatch(/from\s+['"].*planningLifecycle['"]/);
    expect(source).toMatch(/from\s+['"].*planningProvenance['"]/);
    expect(source).toMatch(/from\s+['"].*planningReferenceConflict['"]/);
    expect(source).not.toMatch(/from\s+['"].*planningReferenceSelection['"]/);
    expect(source).not.toMatch(/from\s+['"].*planningReferenceProjection['"]/);
    expect(source).not.toMatch(/from\s+['"].*planningReferenceResolution['"]/);
    expect(source).not.toMatch(/from\s+['"].*executionReadiness['"]/);
    expect(source).not.toMatch(/from\s+['"].*tripPlanning['"]/);
  });

  it('planningReferenceChangeContext never auto-resolves or auto-selects for the user (STEP 29 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceChangeContext.ts');
    expect(source).not.toMatch(/autoPrimary|defaultPrimary|selectDefault|assignPrimary/);
    expect(source).not.toMatch(/selectedId\s*=\s*['"]/);
    expect(source).not.toMatch(/primaryTransportPlanId\s*=\s*['"]/);
    expect(source).not.toMatch(/primaryAccommodationPlanId\s*=\s*['"]/);
    expect(source).not.toMatch(/repairPrimary|reassignPrimary|autoRestore/);
    expect(source).not.toMatch(/setInterval|setTimeout|Date\.now/);
  });

  it('planningReferenceChangeContext never writes or rewrites stored primary ids (STEP 29 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceChangeContext.ts');
    expect(source).not.toMatch(/primaryTransportPlanId\s*=/);
    expect(source).not.toMatch(/primaryAccommodationPlanId\s*=/);
  });

  it('planningReferenceChangeContext message vocabulary never claims booking, payment, or verification (STEP 29 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceChangeContext.ts');
    const constantsMatch = source.match(
      /const (?:PRIMARY_\w+_MESSAGE|SOURCE_CHANGED_MESSAGE|REFERENCE_ADDED_MESSAGE|REFERENCE_REMOVED_MESSAGE)[\s\S]*?\n(?:const |\w)/m
    );
    expect(constantsMatch).not.toBeNull();
    const constantsBlock = constantsMatch![0];
    const bookingWord =
      /\bbooked\b|\bbooking\b|\bpaid\b|\bcharged\b|\bverified\b|\breserved\b|\bcancelled\b|\bticket\b|\bconfirmed availability\b/i;
    expect(constantsBlock).not.toMatch(bookingWord);
  });

  it('planningReferenceSaveReview stays pure and SDK/Firebase/UI/network/clock-free (STEP 30 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceSaveReview.ts');
    expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
    expect(source).not.toMatch(/from\s+['"]react-router-?dom?['"]/);
    expect(source).not.toMatch(/from\s+['"]zustand['"]/);
    expect(source).not.toMatch(FIREBASE_IMPORT);
    expect(source).not.toMatch(/from\s+['"]\.\.\/\.\.\/services\//);
    expect(source).not.toMatch(/from\s+['"]\.\.\/\.\.\/components\//);
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/axios|stripe|provider-api|@google-cloud/);
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/\bDate\.now\(/);
    expect(source).not.toMatch(/new\s+Date\(\s*\)/);
    expect(source).not.toMatch(/\bDate\b/);
    expect(source).not.toMatch(/\bTODO\b|FIXME|setTimeout|setInterval/);
  });

  it('planningReferenceSaveReview is read-only review vocabulary: no persistence, mutation, or edit plumbing (STEP 30 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceSaveReview.ts');
    expect(source).not.toMatch(/from\s+['"]\.\.\/\.\.\/services\//);
    expect(source).not.toMatch(/updateTripPlanning\s*\(/);
    expect(source).not.toMatch(/setDoc|addDoc|updateDoc|deleteDoc|runTransaction/);
    expect(source).not.toMatch(/from\s+['"].*tripPlanningEdit['"]/);
    expect(source).not.toMatch(/from\s+['"].*tripPlanningProposal['"]/);
    expect(source).not.toMatch(/from\s+['"].*planningReferenceSelection['"]/);
    expect(source).not.toMatch(/from\s+['"].*planningReferenceResolution['"]/);
    expect(source).not.toMatch(/from\s+['"].*planningReferenceConflict['"]/);
  });

  it('planningReferenceSaveReview composes with the STEP 29 change-context vocabulary only (STEP 30 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceSaveReview.ts');
    expect(source).toMatch(/from\s+['"]\.\/planningReferenceChangeContext['"]/);
    expect(source).not.toMatch(/from\s+['"].*planningLifecycle['"]/);
    expect(source).not.toMatch(/from\s+['"].*planningProvenance['"]/);
    expect(source).not.toMatch(/from\s+['"].*planningReferenceProjection['"]/);
    expect(source).not.toMatch(/from\s+['"].*executionReadiness['"]/);
    expect(source).not.toMatch(/from\s+['"].*tripPlanning['"]/);
  });

  it('planningReferenceSaveReview never auto-resolves, auto-selects, repairs, or rewrites primary ids (STEP 30 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceSaveReview.ts');
    expect(source).not.toMatch(/autoPrimary|defaultPrimary|selectDefault|assignPrimary/);
    expect(source).not.toMatch(/selectedId\s*=\s*['"]/);
    expect(source).not.toMatch(/primaryTransportPlanId\s*=\s*['"]/);
    expect(source).not.toMatch(/primaryAccommodationPlanId\s*=\s*['"]/);
    expect(source).not.toMatch(/repairPrimary|reassignPrimary|autoRestore/);
    expect(source).not.toMatch(/setInterval|setTimeout|Date\.now/);
    expect(source).not.toMatch(/primaryTransportPlanId\s*=|primaryAccommodationPlanId\s*=/);
  });

  it('planningReferenceSaveReview item sentences never claim booking, payment, or verification (STEP 30 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceSaveReview.ts');
    const describeMatch = source.match(
      /export function describePlanningReferenceSaveReviewItem[\s\S]*?\n\}\s*\nfunction quote/
    );
    expect(describeMatch).not.toBeNull();
    const describeBlock = describeMatch![0];
    const bookingWord =
      /\bbooked\b|\bbooking\b|\bpaid\b|\bcharged\b|\bverified\b|\breserved\b|\bcancelled\b|\bticket\b|\bconfirmed availability\b/i;
    expect(describeBlock).not.toMatch(bookingWord);
  });

  it('planningReferenceSaveReview never emits a review for reference add/remove, notes, text, budget, or tasks (STEP 30 boundary)', () => {
    const source = readSource('domain/trips/planningReferenceSaveReview.ts');
    expect(source).toMatch(/case 'reference-added':/);
    expect(source).toMatch(/case 'reference-removed':/);
    const planChangeBlock = source.match(
      /function buildPlanChangeItem[\s\S]*?\n\}\s*(?:\n|function findPlanLabel)/
    );
    expect(planChangeBlock).not.toBeNull();
    expect(planChangeBlock![0]).toMatch(/reference-added|reference-removed/);
    expect(planChangeBlock![0]).not.toMatch(/mode\b|location\b|notes\b|budget\b|task\b/);
  });

  it('PlanningEditor STEP 31 keeps the review derived each render instead of snapshotting it in state', () => {
    const source = readSource('components/trips/PlanningEditor.tsx');
    expect(source).toMatch(/const saveReview = classifyPlanningReferenceSaveReview\(/);
    expect(source).not.toMatch(/useState\s*<\s*PlanningReferenceSaveReview/);
    expect(source).not.toMatch(/setSaveReview\s*\(/);
    expect(source).not.toMatch(/saveReviewState|reviewSnapshot|capturedReview/);
    expect(source).not.toMatch(/JSON\.stringify\(saveReview\)/);
  });

  it('PlanningEditor STEP 31 exposes exactly one synchronous save channel (the onSave callback) with no second persistence path', () => {
    const source = readSource('components/trips/PlanningEditor.tsx');
    expect(source.match(/onSave\(existing\)/g)).toHaveLength(2);
    expect(source.match(/onSave\(/g)).toHaveLength(2);
    expect(source).not.toMatch(/updateTripPlanning/);
    expect(source).not.toMatch(/import\s+.*\btripService\b/);
    expect(source).not.toMatch(/from\s+['"].*(xstate|redux|zustand|jotai)['"]/);
  });

  it('PlanningEditor STEP 31 guards in-flight save submissions without ever mutating the draft or baseline', () => {
    const source = readSource('components/trips/PlanningEditor.tsx');
    expect(source.match(/saveSubmitInFlightRef\.current = true;/g)).toHaveLength(2);
    expect(source.match(/saveSubmitInFlightRef\.current = false;/g)).toHaveLength(1);
    expect(source.match(/saveSubmitInFlightRef/g)).toHaveLength(6);
    expect(source).not.toMatch(/draft\s*=\s*existing\s*;/);
    expect(source).not.toMatch(/trip\s*=\s*existing\s*;/);
    expect(source).not.toMatch(/setPlanningDraft\s*\(/);
  });

  it('server boundary is exactly the three four-module core boundaries (STEPS 42, 67, 68)', () => {
    const files = listDir('services/serverBoundary')
      .map((f) => f.split('\\').join('/'))
      .sort();
    expect(files).toEqual([
      'services/serverBoundary/serverDiscoveryAuth.ts',
      'services/serverBoundary/serverDiscoveryContract.ts',
      'services/serverBoundary/serverDiscoveryRunner.ts',
      'services/serverBoundary/serverDiscoveryValidation.ts',
      'services/serverBoundary/serverExecutionAuth.ts',
      'services/serverBoundary/serverExecutionCapabilityAuth.ts',
      'services/serverBoundary/serverExecutionCapabilityContract.ts',
      'services/serverBoundary/serverExecutionCapabilityRunner.ts',
      'services/serverBoundary/serverExecutionCapabilityValidation.ts',
      'services/serverBoundary/serverExecutionContract.ts',
      'services/serverBoundary/serverExecutionRunner.ts',
      'services/serverBoundary/serverExecutionValidation.ts',
    ]);
  });

  it('server execution boundary is exactly four pure core modules (STEP 67 boundary)', () => {
    expect(executionBoundaryFiles('serverExecution')).toEqual([
      'services/serverBoundary/serverExecutionAuth.ts',
      'services/serverBoundary/serverExecutionContract.ts',
      'services/serverBoundary/serverExecutionRunner.ts',
      'services/serverBoundary/serverExecutionValidation.ts',
    ]);
  });

  it('server execution capability boundary is exactly four pure core modules (STEP 68 boundary)', () => {
    expect(capabilityBoundaryFiles()).toEqual([
      'services/serverBoundary/serverExecutionCapabilityAuth.ts',
      'services/serverBoundary/serverExecutionCapabilityContract.ts',
      'services/serverBoundary/serverExecutionCapabilityRunner.ts',
      'services/serverBoundary/serverExecutionCapabilityValidation.ts',
    ]);
  });

  it('server execution boundary is deterministic, secret-free, SDK/Firebase/UI-free (STEP 67 boundary)', () => {
    for (const file of executionBoundaryFiles('serverExecution')) {
      const source = readSource(file);
      expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
      expect(source).not.toMatch(/from\s+['"]react-router-?dom?['"]/);
      expect(source).not.toMatch(/from\s+['"]zustand['"]/);
      expect(source).not.toMatch(FIREBASE_IMPORT);
      expect(source).not.toMatch(/from\s+['"]firebase-admin['"]/);
      expect(source).not.toMatch(/from\s+['"]firebase-functions/);
      expect(source).not.toMatch(/import\.meta\.env/);
      expect(source).not.toMatch(/process\.env/);
      expect(source).not.toMatch(/axios|stripe|provider-api|@google-cloud/);
      expect(source).not.toMatch(/\bDate\.now\(/);
      expect(source).not.toMatch(/new\s+Date\(\s*\)/);
      expect(source).not.toMatch(/\bMath\.random\b/);
      expect(source).not.toMatch(/fetch\s*\(/);
    }
  });

  it('server execution boundary is read-only: no persistence, trip, or Firestore access (STEP 67 boundary)', () => {
    for (const file of executionBoundaryFiles('serverExecution')) {
      const source = readSource(file);
      expect(source).not.toMatch(/from\s+['"].*tripService['"]/);
      expect(source).not.toMatch(/from\s+['"].*firestoreService['"]/);
      expect(source).not.toMatch(/from\s+['"].*dataConnectService['"]/);
      expect(source).not.toMatch(/from\s+['"].*mockDiscovery['"]/);
      expect(source).not.toMatch(/updateTripPlanning\s*\(/);
      expect(source).not.toMatch(/setDoc|addDoc|updateDoc|deleteDoc|runTransaction/);
    }
  });

  it('server execution boundary stays read-only: no booking/payment/ticket vocabulary (STEP 67 boundary)', () => {
    for (const file of executionBoundaryFiles('serverExecution')) {
      const source = readSource(file);
      expect(source).not.toMatch(/submit-booking|cancel-booking|prepare-booking/);
      expect(source).not.toMatch(/charge|payment-intent|paid|invoice/);
    }
  });

  it('server execution boundary reaches the provider only through the STEP 66 service (STEP 67 boundary)', () => {
    for (const file of executionBoundaryFiles('serverExecution')) {
      const source = readSource(file);
      // No direct adapter import: the boundary composes the service instead.
      // (The connection *type* is permitted as a test seam; the exact permitted
      // import set is asserted below.)
      expect(source).not.toMatch(/from\s+['"][^'"]*amadeusExecutionAdapter['"]/);
      // No provider request is ever constructed here; the validated request is
      // forwarded to the provider unchanged.
      expect(source).not.toMatch(/amadeus\.com|api\.amadeus/);
    }

    const runner = readSource('services/serverBoundary/serverExecutionRunner.ts');
    // The only STEP 66 modules the boundary may reach for: the service, the
    // shared gate, and the connection *type* used as a test seam.
    const realExecutionModules = [
      ...new Set(
        (runner.match(/from\s+['"][^'"]*realExecution\/[^'"]*['"]/g) ?? []).map((line) =>
          /from\s+['"]([^'"]+)['"]/.exec(line)?.[1] ?? ''
        )
      ),
    ].sort();
    expect(realExecutionModules).toEqual([
      '../realExecution/amadeusExecutionConfig',
      '../realExecution/amadeusExecutionConnection',
      '../realExecution/realExecutionService',
    ]);
    // Readiness is read from STEP 66, never reimplemented.
    expect(runner).toMatch(/getAmadeusExecutionAttemptGate/);
    // The provider is exercised through the STEP 59 contract.
    expect(runner).toMatch(/provider\.execute\(/);
  });

  it('server execution boundary reuses the single existing ID-token verifier (STEP 67 boundary)', () => {
    const auth = readSource('services/serverBoundary/serverExecutionAuth.ts');
    expect(auth).toMatch(/from\s+['"]\.\/serverDiscoveryAuth['"]/);
    expect(auth).toMatch(/verifyServerDiscoveryIdToken/);
    // The signature takes a token and a verifier, and nothing else - in
    // particular no request body from which an identity could be read.
    expect(auth).toMatch(
      /export async function verifyServerExecutionIdToken\(\s*idToken: unknown,\s*verifier: IdTokenVerifier,?\s*\)/
    );
    // No second verification mechanism is introduced.
    expect(auth).not.toMatch(/firebase-admin|getAuth\(\)|jwt\.decode|auth\.verify/);
  });

  it('server execution host is fail-closed and passes no network seam (STEP 67 boundary)', () => {
    const host = readFileSync(join(process.cwd(), 'functions', 'src', 'index.ts'), 'utf8');
    expect(host).toMatch(/export const realExecution = onRequest\(/);
    expect(host).toMatch(/loadAmadeusExecutionConfigFromEnv\(process\.env\)/);
    expect(host).toMatch(/verifyServerExecutionIdToken/);
    expect(host).toMatch(/runServerBoundaryExecution/);
    // The execution host must not construct or inject a transport/connection:
    // STEP 66's default is structurally unable to reach the network.
    const executionFunction = host.slice(host.indexOf('export const realExecution'));
    expect(executionFunction).not.toMatch(/createAmadeusExecutionConnection/);
    expect(executionFunction).not.toMatch(/connection:/);
    expect(executionFunction).not.toMatch(/createAmadeusFetchTransport/);
  });

  it('server discovery boundary is deterministic, secret-free, SDK/Firebase/UI-free (STEP 42 boundary)', () => {
    const files = listDir('services/serverBoundary').map((f) => f.split('\\').join('/'));
    for (const file of files) {
      const source = readSource(file);
      expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
      expect(source).not.toMatch(/from\s+['"]react-router-?dom?['"]/);
      expect(source).not.toMatch(/from\s+['"]zustand['"]/);
      expect(source).not.toMatch(FIREBASE_IMPORT);
      expect(source).not.toMatch(/from\s+['"]firebase-admin['"]/);
      expect(source).not.toMatch(/from\s+['"]firebase-functions/);
      expect(source).not.toMatch(/import\.meta\.env/);
      expect(source).not.toMatch(/process\.env/);
      expect(source).not.toMatch(/axios|stripe|provider-api|@google-cloud/);
      expect(source).not.toMatch(/\bDate\.now\(/);
      expect(source).not.toMatch(/new\s+Date\(\s*\)/);
      expect(source).not.toMatch(/\bMath\.random\b/);
      expect(source).not.toMatch(/fetch\s*\(/);
    }
  });

  it('server discovery boundary is a read-only seam: no persistence, trip, or Firestore access (STEP 42 boundary)', () => {
    const files = listDir('services/serverBoundary').map((f) => f.split('\\').join('/'));
    for (const file of files) {
      const source = readSource(file);
      expect(source).not.toMatch(/from\s+['"].*tripService['"]/);
      expect(source).not.toMatch(/from\s+['"].*firestoreService['"]/);
      expect(source).not.toMatch(/from\s+['"].*dataConnectService['"]/);
      expect(source).not.toMatch(/from\s+['"].*mockDiscovery['"]/);
      expect(source).not.toMatch(/updateTripPlanning\s*\(/);
      expect(source).not.toMatch(/setDoc|addDoc|updateDoc|deleteDoc|runTransaction/);
    }
  });

  it('server discovery boundary stays read-only: no booking/payment/ticket vocabulary (STEP 42 boundary)', () => {
    const files = listDir('services/serverBoundary').map((f) => f.split('\\').join('/'));
    for (const file of files) {
      const source = readSource(file);
      expect(source).not.toMatch(/submit-booking|cancel-booking|prepare-booking/);
      expect(source).not.toMatch(/charge|payment-intent|paid|invoice/);
    }
  });

  it('browser server-discovery client is deterministic, secret-free, and never calls the provider directly (STEP 42 boundary)', () => {
    const source = readSource('services/serverDiscoveryClient.ts');
    expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
    expect(source).not.toMatch(/from\s+['"]react-router-?dom?['"]/);
    expect(source).not.toMatch(/from\s+['"]zustand['"]/);
    expect(source).not.toMatch(FIREBASE_IMPORT);
    expect(source).not.toMatch(/from\s+['"]firebase-admin['"]/);
    expect(source).not.toMatch(/from\s+['"]firebase-functions/);
    expect(source).not.toMatch(/import\.meta\.env/);
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/axios|stripe|provider-api|@google-cloud/);
    expect(source).not.toMatch(/\bDate\.now\(/);
    expect(source).not.toMatch(/new\s+Date\(\s*\)/);
    expect(source).not.toMatch(/\bMath\.random\b/);
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/from\s+['"][^'"]*amadeus/i);
  });

  it('browser server-discovery client never persists or books, and stays provider-neutral (STEP 42 boundary)', () => {
    const source = readSource('services/serverDiscoveryClient.ts');
    expect(source).not.toMatch(/from\s+['"].*tripService['"]/);
    expect(source).not.toMatch(/from\s+['"].*firestoreService['"]/);
    expect(source).not.toMatch(/from\s+['"].*dataConnectService['"]/);
    expect(source).not.toMatch(/from\s+['"].*mockDiscovery['"]/);
    expect(source).not.toMatch(/updateTripPlanning\s*\(/);
    expect(source).not.toMatch(/setDoc|addDoc|updateDoc|deleteDoc|runTransaction/);
    expect(source).not.toMatch(/submit-booking|cancel-booking|prepare-booking/);
    expect(source).not.toMatch(/charge|payment-intent|paid|invoice/);
  });

  // ---------------------------------------------------------------------------
  // STEP 68 - the read-only execution CAPABILITY boundary.
  // ---------------------------------------------------------------------------

  it('server execution capability boundary is deterministic, secret-free, SDK/Firebase/UI-free (STEP 68 boundary)', () => {
    for (const file of capabilityBoundaryFiles()) {
      const source = readSource(file);
      expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
      expect(source).not.toMatch(/from\s+['"]react-router-?dom?['"]/);
      expect(source).not.toMatch(/from\s+['"]zustand['"]/);
      expect(source).not.toMatch(FIREBASE_IMPORT);
      expect(source).not.toMatch(/from\s+['"]firebase-admin['"]/);
      expect(source).not.toMatch(/from\s+['"]firebase-functions/);
      expect(source).not.toMatch(/import\.meta\.env/);
      expect(source).not.toMatch(/process\.env/);
      expect(source).not.toMatch(/axios|stripe|provider-api|@google-cloud/);
      expect(source).not.toMatch(/\bDate\.now\(/);
      expect(source).not.toMatch(/new\s+Date\(\s*\)/);
      expect(source).not.toMatch(/\bMath\.random\b/);
      expect(source).not.toMatch(/fetch\s*\(/);
    }
  });

  it('server execution capability boundary is read-only and has no provider or connection injection seam (STEP 68 boundary)', () => {
    for (const file of capabilityBoundaryFiles()) {
      const source = readSource(file);
      expect(source).not.toMatch(/from\s+['"].*tripService['"]/);
      expect(source).not.toMatch(/from\s+['"].*firestoreService['"]/);
      expect(source).not.toMatch(/from\s+['"].*dataConnectService['"]/);
      expect(source).not.toMatch(/updateTripPlanning\s*\(/);
      expect(source).not.toMatch(/setDoc|addDoc|updateDoc|deleteDoc|runTransaction/);
      expect(source).not.toMatch(/submit-booking|cancel-booking|prepare-booking/);
      expect(source).not.toMatch(/charge|payment-intent|paid|invoice/);
    }

    // A capability seam would be a liability, not a convenience: injecting a
    // provider here would let a caller's choice change the *reported capability*.
    // STEP 67 needs a connection seam to reach a provider failure; this boundary
    // reaches no provider at all, so it must have none.
    for (const file of capabilityBoundaryFiles()) {
      const source = readSource(file);
      expect(source).not.toMatch(/from\s+['"][^'"]*amadeusExecutionConnection['"]/);
      expect(source).not.toMatch(/AmadeusExecutionConnection/);
    }
  });

  it('server execution capability boundary never invokes a provider execute (STEP 68 boundary)', () => {
    // The single most important structural guarantee of this step: reading
    // capabilities has no path to execution.
    for (const file of capabilityBoundaryFiles()) {
      expect(readSource(file)).not.toMatch(/\.execute\(/);
    }
    // The STEP 67 runner, by contrast, does execute - so the guard above is
    // discriminating rather than vacuous.
    expect(readSource('services/serverBoundary/serverExecutionRunner.ts')).toMatch(
      /provider\.execute\(/
    );
  });

  it('server execution capability boundary reads capability state only through the STEP 66 service (STEP 68 boundary)', () => {
    for (const file of capabilityBoundaryFiles()) {
      const source = readSource(file);
      // No direct adapter import: the capability answer is read from the profile
      // the service already holds, so no capability logic is duplicated.
      expect(source).not.toMatch(/from\s+['"][^'"]*amadeusExecutionAdapter['"]/);
      expect(source).not.toMatch(/amadeus\.com|api\.amadeus/);
    }

    const runner = readSource('services/serverBoundary/serverExecutionCapabilityRunner.ts');
    const realExecutionModules = [
      ...new Set(
        (runner.match(/from\s+['"][^'"]*realExecution\/[^'"]*['"]/g) ?? []).map((line) =>
          /from\s+['"]([^'"]+)['"]/.exec(line)?.[1] ?? ''
        )
      ),
    ].sort();
    expect(realExecutionModules).toEqual([
      '../realExecution/amadeusExecutionConfig',
      '../realExecution/realExecutionService',
    ]);

    // Readiness is read from STEP 66, never reimplemented.
    expect(runner).toMatch(/getAmadeusExecutionAttemptGate/);
    // "Executable" is decided by the STEP 20 operational guard, so the boundary
    // cannot promote a merely-present capability to an available one.
    expect(runner).toMatch(/getAdapterOperationalCapabilityIds/);
    expect(runner).toMatch(/isProviderCapabilityId/);
    // The provider profile is read from the composed service.
    expect(runner).toMatch(/createRealExecutionService/);
    expect(runner).toMatch(/amadeusCapabilityProfile/);
  });

  it('server execution capability boundary reuses the STEP 67 verifier and adds no auth mechanism (STEP 68 boundary)', () => {
    const auth = readSource('services/serverBoundary/serverExecutionCapabilityAuth.ts');
    expect(auth).toMatch(/from\s+['"]\.\/serverExecutionAuth['"]/);
    expect(auth).toMatch(/verifyServerExecutionIdToken/);
    // No second verification mechanism is introduced anywhere in the boundary.
    for (const file of capabilityBoundaryFiles()) {
      const source = readSource(file);
      expect(source).not.toMatch(/verifyIdToken\s*\(/);
      expect(source).not.toMatch(/getAuth\(/);
    }
  });

  it('server execution capability boundary accepts no provider selection from the client (STEP 68 boundary)', () => {
    const validation = readSource(
      'services/serverBoundary/serverExecutionCapabilityValidation.ts'
    );
    // The accepted request is a GET with no body, so there is no field in which a
    // provider, capability, host, method, or credential could be named.
    expect(validation).toMatch(/'GET'/);
    expect(validation).toMatch(/unexpected-body/);
    // Only these two problems exist, and both are refused before evaluation.
    const problems = [...new Set(validation.match(/'(?:unsupported-method|unexpected-body)'/g) ?? [])]
      .sort();
    expect(problems).toEqual(["'unexpected-body'", "'unsupported-method'"]);

    // The wire contract is closed: a structural check on the declared fields, not
    // a prose scan. No provider-selection or secret field can be added to either
    // the body or a provider entry without failing here.
    const contract = readSource(
      'services/serverBoundary/serverExecutionCapabilityContract.ts'
    );
    expect(interfaceFields(contract, 'ServerExecutionCapabilityResponse')).toEqual([
      'kind',
      'providers',
      'problem',
    ]);
    expect(interfaceFields(contract, 'ServerExecutionCapabilityEntry')).toEqual([
      'providerId',
      'status',
      'capabilityIds',
      'reason',
    ]);
    // No field anywhere in the contract may carry a provider address, a secret, or
    // an upstream payload.
    for (const forbidden of [
      'providerUrl',
      'accessToken',
      'clientSecret',
      'clientId',
      'apiKey',
      'endpoint',
      'baseUrl',
      'config',
    ]) {
      expect(interfaceFields(contract, 'ServerExecutionCapabilityEntry')).not.toContain(forbidden);
      expect(interfaceFields(contract, 'ServerExecutionCapabilityResponse')).not.toContain(
        forbidden
      );
    }
  });

  it('STEP 68 adds a separate function without changing the existing execution or discovery routes', () => {
    const host = readFileSync(join(process.cwd(), 'functions', 'src', 'index.ts'), 'utf8');
    // A separate export, not a multi-purpose handler on the execution endpoint.
    expect(host).toContain('export const realExecutionCapabilities = onRequest(');
    expect(host).toContain('export const realExecution = onRequest(');
    expect(host).toContain('export const realDiscovery = onRequest(');
    // The capability host reads no body content and passes no connection.
    expect(host).toMatch(
      /runServerBoundaryExecutionCapabilities\(\{[\s\S]*?method: request\.method,[\s\S]*?config,/
    );

    // Routing: the more specific capability path must precede the `/api/**`
    // discovery catch-all, which would otherwise swallow it, and both must
    // precede the SPA fallback.
    const firebaseConfig = JSON.parse(
      readFileSync(join(process.cwd(), 'firebase.json'), 'utf8')
    ) as {
      hosting: {
        rewrites: Array<{ source: string; function?: { functionId: string }; destination?: string }>;
      };
    };
    const rewrites = firebaseConfig.hosting.rewrites;
    const sources = rewrites.map((r) => r.source);

    expect(sources.indexOf('/api/real-execution/capabilities')).toBe(0);
    expect(sources.indexOf('/api/real-execution')).toBe(1);
    expect(sources.indexOf('/api/**')).toBe(2);
    expect(sources.indexOf('**')).toBe(3);
    // The SPA catch-all is still the last rewrite.
    expect(rewrites[rewrites.length - 1].destination).toBe('/index.html');

    // The existing execution route still points at the unchanged function.
    expect(rewrites[1].function?.functionId).toBe('realExecution');
    expect(rewrites[0].function?.functionId).toBe('realExecutionCapabilities');
    expect(rewrites[2].function?.functionId).toBe('realDiscovery');
  });

  it('STEP 68 adds no UI integration and no browser-exposed Amadeus configuration', () => {
    for (const entry of ['src/main.tsx', 'src/App.tsx']) {
      const source = readFileSync(join(process.cwd(), entry), 'utf8');
      expect(source).not.toMatch(/capabilit/i);
    }
    const capabilities = listDir('components').filter((f) => /capabilit/i.test(f));
    expect(capabilities).toEqual([]);

    // No `VITE_` shadow of an Amadeus key may be *read* anywhere in the app. The
    // check is on env access rather than the literal, because the server config
    // modules legitimately mention `VITE_` in a comment to state that such a key
    // is never consulted.
    const appSources = sourceFiles(join(process.cwd(), 'src')).filter(
      (f) => !f.includes(join('src', 'test'))
    );
    for (const file of appSources) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.match(/import\.meta\.env\.[A-Za-z0-9_]+/g) ?? []) {
        expect(match).not.toMatch(/VITE_AMADEUS/i);
      }
    }
    // And the capability boundary reaches no environment at all.
    for (const file of capabilityBoundaryFiles()) {
      expect(readSource(file)).not.toMatch(/import\.meta\.env/);
    }
  });

  // STEP 69: the browser capability service. The browser may learn capabilities
  // only through the STEP 68 endpoint, so this module is where a boundary
  // regression would be most damaging: a stray server-boundary import would let
  // the browser reach validation or auth internals, and a stray provider import
  // would let it reach a provider directly. Both are asserted structurally.
  describe('STEP 69 trip execution capability service', () => {
    const TRIP_EXECUTION_CAPABILITY_SERVICE =
      'services/tripExecution/tripExecutionCapabilityService.ts';

    it('reaches no server-boundary module', () => {
      const source = readSource(TRIP_EXECUTION_CAPABILITY_SERVICE);
      expect(source).not.toContain('serverBoundary');
      expect(source).not.toMatch(/from\s+['"][^'"]*serverBoundary/);
      // Not even by the other capability clients, which live in `services/`.
      expect(source).not.toMatch(/from\s+['"][^'"]*serverDiscoveryClient/);
    });

    it('imports no Firebase, React, Router, or Zustand module', () => {
      const source = readSource(TRIP_EXECUTION_CAPABILITY_SERVICE);
      expect(source).not.toMatch(FIREBASE_IMPORT);
      for (const forbidden of [
        'react',
        'react-dom',
        'react-router',
        'zustand',
        '@tanstack',
      ]) {
        expect(source).not.toMatch(
          new RegExp(`from\\s+['"]${forbidden.replace('/', '\\/')}`)
        );
      }
    });

    it('imports no provider SDK, Amadeus client, or transport implementation', () => {
      const code = readCode(TRIP_EXECUTION_CAPABILITY_SERVICE);
      expect(code).not.toMatch(/amadeus/i);
      expect(code).not.toMatch(/axios/);
      // The HTTP transport and the ID token are both injected, so there is no
      // literal `fetch(` and no token acquisition of its own.
      expect(code).not.toMatch(/fetch\s*\(/);
      expect(code).not.toMatch(/getIdToken|onAuthStateChanged|signIn|signOut/);
    });

    it('reaches no environment, secret, storage, or clock', () => {
      const code = readCode(TRIP_EXECUTION_CAPABILITY_SERVICE);
      expect(code).not.toMatch(/import\.meta\.env/);
      expect(code).not.toMatch(/process\.env/);
      expect(code).not.toMatch(/AMADEUS|CLIENT_SECRET|VITE_/);
      expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
      expect(code).not.toMatch(/Date\.now\(|new\s+Date\(\s*\)|Math\.random/);
    });

    it('declares no cache, timer, or retry of its own', () => {
      // Checked against code only: the module documents the absence of retries in
      // prose, and prose must not be mistaken for a retry mechanism.
      const code = readCode(TRIP_EXECUTION_CAPABILITY_SERVICE);
      expect(code).not.toMatch(/setTimeout|setInterval|requestAnimationFrame/);
      expect(code).not.toMatch(/\bcaches\b|CacheStorage/);
      expect(code).not.toMatch(/\bretry|backoff|attempts?\s*:/i);
      // No loop re-issues the request.
      expect(code).not.toMatch(/\b(for|while|do)\b[^{]*\b(fetchImpl|response)\b/);
    });

    it('reaches no provider adapter, credential store, or execution pipeline', () => {
      const source = readSource(TRIP_EXECUTION_CAPABILITY_SERVICE);
      for (const forbidden of [
        'providerAdapter',
        'mockTripExecutionProvider',
        'tripExecutionDispatch',
        'tripExecutionOrchestrator',
        'tripExecutionPipeline',
        'credentialStore',
        'serverExecutionRunner',
        'amadeus-execution',
      ]) {
        expect(source).not.toContain(forbidden);
      }
    });

    it('imports only the shared safe-error type from the domain layer', () => {
      // A single type-only import is the entire permitted dependency surface: it
      // reuses the existing safe error vocabulary instead of inventing a second
      // one, and pulls in no runtime code. Asserting the full import list means a
      // future dependency cannot be added without this test failing first.
      const source = readSource(TRIP_EXECUTION_CAPABILITY_SERVICE);
      const imports = [...source.matchAll(/import\s+([\s\S]*?)\s+from\s+'([^']+)';/g)].map(
        (match) => ({ clause: match[1].trim(), module: match[2] })
      );
      expect(imports).toEqual([
        {
          clause: 'type { ProviderSafeError, ProviderSafeErrorCategory }',
          module: '../../domain/providers/executionOperations',
        },
      ]);
      // A type-only import contributes nothing at runtime, so this module has no
      // dependency of its own to bundle.
      expect(imports[0].clause.startsWith('type ')).toBe(true);
    });
  });

  // STEP 70: capability-aware execution eligibility. This module is pure
  // calculation, so its whole dependency surface must stay inside the pure
  // domain and the type-only STEP 69 contracts. A regression here would either
  // give a calculation function a way to perform I/O, or let the eligibility
  // layer reach into execution planning and collapse the STEP 63 / STEP 70
  // separation.
  describe('STEP 70 trip execution eligibility', () => {
    const TRIP_EXECUTION_ELIGIBILITY = 'services/tripExecution/tripExecutionEligibility.ts';

    it('imports only pure domain modules and type-only step contracts', () => {
      const source = readSource(TRIP_EXECUTION_ELIGIBILITY);
      const imports = [
        ...source.matchAll(/import\s+((?:type\s+)?)([\s\S]*?)\s+from\s+'([^']+)';/g),
      ].map((match) => ({
        typeOnly: match[1].trim().startsWith('type'),
        module: match[3],
      }));
      expect(imports).toEqual([
        { typeOnly: false, module: '../../domain/providers/providerResults' },
        { typeOnly: false, module: '../../domain/providers/providerCapabilities' },
        { typeOnly: false, module: '../../domain/trips/tripPlanningExecutionRequest' },
        // The STEP 69 snapshot types contribute no runtime code.
        { typeOnly: true, module: './tripExecutionCapabilityService' },
      ]);
    });

    it('reaches no server, provider, transport, or persistence layer', () => {
      const code = readCode(TRIP_EXECUTION_ELIGIBILITY);
      expect(code).not.toMatch(/serverBoundary|serverExecution|realExecution/);
      expect(code).not.toMatch(/fetch\s*\(|XMLHttpRequest|WebSocket|httpsCallable|getFunctions/);
      expect(code).not.toMatch(/firebase|firestore|collection\(|doc\(|addDoc|setDoc/i);
      expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
      expect(code).not.toMatch(/https?:\/\//);
    });

    it('reaches no React, Router, Zustand, or browser API', () => {
      const code = readCode(TRIP_EXECUTION_ELIGIBILITY);
      for (const forbidden of ['react', 'react-dom', 'react-router', 'zustand']) {
        expect(code).not.toMatch(new RegExp(`from\\s+['"]${forbidden}`));
      }
      expect(code).not.toMatch(/\bwindow\.|\bdocument\.|\bnavigator\.|\blocation\./);
    });

    it('never imports or invokes the STEP 63/65 execution path', () => {
      const code = readCode(TRIP_EXECUTION_ELIGIBILITY);
      // Eligibility is not planning and not execution. Reaching the plan
      // creator, the orchestrator, the pipeline, or a provider contract would
      // merge two responsibilities that must stay separate.
      for (const forbidden of [
        'tripExecutionPlan',
        'tripExecutionOrchestrator',
        'tripExecutionPipeline',
        'tripExecutionDispatch',
        'tripExecutionProvider',
        'tripExecutionCapability',
        'orchestrateTripExecution',
        'executeTripExecutionPipeline',
        'createTripExecutionPlan',
        'evaluateTripExecutionCapability',
      ]) {
        expect(code).not.toContain(forbidden);
      }
      // No provider contract, so no provider object can be invoked.
      expect(code).not.toMatch(/\.execute\(|TripExecutionProvider\b/);
    });

    it('reaches no credential, secret, or provider configuration', () => {
      const code = readCode(TRIP_EXECUTION_ELIGIBILITY);
      expect(code).not.toMatch(/credential|clientSecret|accessToken|apiKey|refreshToken/i);
      expect(code).not.toMatch(/AMADEUS|VITE_AMADEUS|import\.meta\.env|process\.env/);
      expect(code).not.toMatch(/amadeus/i);
    });

    it('is deterministic: no clock, randomness, or running state', () => {
      const code = readCode(TRIP_EXECUTION_ELIGIBILITY);
      expect(code).not.toMatch(/Date\.now\(|new\s+Date\(\s*\)|Math\.random/);
      // A pure calculation returns a value; it never awaits or defers.
      expect(code).not.toMatch(/\basync\b|\bawait\b|\bPromise\b/);
      expect(code).not.toMatch(/class\s+\w+/);
    });

    it('fails closed: it defines no booking, payment, or purchase capability', () => {
      const source = readSource(TRIP_EXECUTION_ELIGIBILITY);
      // Eligibility may not widen the Step 20 vocabulary with an execution
      // surface that no provider can report. The literal scan covers strings
      // written in either quote style, and the reason vocabulary is asserted to
      // be the closed list that contains none of them.
      for (const invented of [
        'flight-booking',
        'hotel-booking',
        'accommodation-booking',
        'payment',
        'charge-card',
        'purchase',
        'ticket-purchase',
        'refund',
      ]) {
        expect(source).not.toContain(`'${invented}'`);
        expect(source).not.toContain(`"${invented}"`);
      }
      // The recognized capability ids are re-exported from the provider domain,
      // never redefined here: the vocabulary has exactly one owner.
      expect(source).toMatch(/export \{ PROVIDER_CAPABILITY_IDS \}/);
      expect(source).not.toMatch(/export (?:const|type) PROVIDER_CAPABILITY_IDS/);
      expect(source).not.toMatch(/export (?:const|type) ProviderCapabilityId/);
    });
  });

  // STEP 71: plan qualification. This is the last pure step before dispatch, so
  // its boundary is the one that most directly protects the "eligibility is not
  // execution" invariant. A regression that let a provider object, the
  // orchestrator, or the pipeline in here would turn a calculation into an
  // execution path.
  describe('STEP 71 trip execution plan qualification', () => {
    const TRIP_EXECUTION_PLAN_QUALIFICATION =
      'services/tripExecution/tripExecutionPlanQualification.ts';

    it('imports only pure domain and pure execution-domain contracts', () => {
      const source = readSource(TRIP_EXECUTION_PLAN_QUALIFICATION);
      const imports = [
        ...source.matchAll(/import\s+((?:type\s+)?)([\s\S]*?)\s+from\s+'([^']+)';/g),
      ].map((match) => ({ typeOnly: match[1].trim().startsWith('type'), module: match[3] }));
      expect(imports).toEqual([
        { typeOnly: false, module: '../../domain/providers/providerResults' },
        { typeOnly: false, module: '../../domain/providers/providerCapabilities' },
        { typeOnly: false, module: '../../domain/trips/tripPlanningExecutionRequest' },
        { typeOnly: false, module: '../../domain/trips/tripPlanningExecutionAuthorization' },
        { typeOnly: false, module: './tripExecutionDispatch' },
        // Only the identity prefix, never the provider contract's runtime shape.
        { typeOnly: false, module: './tripExecutionProvider' },
        // The plan is consumed, never built: the validator only.
        { typeOnly: false, module: './tripExecutionPlan' },
        { typeOnly: false, module: './tripExecutionEligibility' },
      ]);
    });

    it('never reaches an execution, orchestration, or pipeline path', () => {
      const code = readCode(TRIP_EXECUTION_PLAN_QUALIFICATION);
      for (const forbidden of [
        'tripExecutionOrchestrator',
        'tripExecutionPipeline',
        'orchestrateTripExecution',
        'executeTripExecutionPipeline',
        'mockTripExecutionProvider',
        'createTripExecutionPlan',
        'getTripExecutionPlanId',
        '.execute(',
      ]) {
        expect(code, forbidden).not.toContain(forbidden);
      }
    });

    it('reaches no provider object, server, network, or persistence layer', () => {
      const code = readCode(TRIP_EXECUTION_PLAN_QUALIFICATION);
      expect(code).not.toMatch(/TripExecutionProvider\b/);
      expect(code).not.toMatch(/serverBoundary|serverExecution|realExecution|amadeus/i);
      expect(code).not.toMatch(/fetch\s*\(|XMLHttpRequest|httpsCallable|getFunctions/);
      expect(code).not.toMatch(/firebase|firestore|addDoc|setDoc/i);
      expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    });

    it('stays pure: no asynchrony, clock, environment, or global mutable state', () => {
      const code = readCode(TRIP_EXECUTION_PLAN_QUALIFICATION);
      expect(code).not.toMatch(/\basync\b|\bawait\b|\bPromise\b/);
      expect(code).not.toMatch(/setTimeout|setInterval/);
      expect(code).not.toMatch(/Date\.now\(|new\s+Date\(\s*\)|Math\.random/);
      expect(code).not.toMatch(/import\.meta\.env|process\.env/);
      expect(code).not.toMatch(/^(let|var)\s/m);
      expect(code).not.toMatch(/class\s+\w+/);
    });

    it('reaches no UI, React, Router, or Zustand layer', () => {
      const code = readCode(TRIP_EXECUTION_PLAN_QUALIFICATION);
      for (const forbidden of ['react', 'react-dom', 'react-router', 'zustand']) {
        expect(code).not.toMatch(new RegExp(`from\\s+['"]${forbidden}`));
      }
      expect(code).not.toMatch(/\bwindow\.|\bdocument\.|\bnavigator\./);
    });

    it('invents no booking, payment, or execution capability', () => {
      const source = readSource(TRIP_EXECUTION_PLAN_QUALIFICATION);
      for (const invented of [
        'flight-booking',
        'hotel-booking',
        'payment',
        'charge-card',
        'purchase',
        'ticket-purchase',
        'refund',
      ]) {
        expect(source).not.toContain(`'${invented}'`);
      }
      // The capability vocabulary stays owned by the provider domain.
      expect(source).not.toMatch(/export (?:const|type) (?:PROVIDER_CAPABILITY_IDS|ProviderCapabilityId)/);
    });

    it('does not sort, rank, or score providers', () => {
      const code = readCode(TRIP_EXECUTION_PLAN_QUALIFICATION);
      expect(code).not.toMatch(/\.sort\s*\(|\.reverse\s*\(/);
      expect(code).not.toMatch(/\b(rank|score|bestProvider|preferred)\b/i);
    });
  });

  // STEP 72: qualified dispatch. This is the first module permitted to build a
  // dispatch instruction, so its boundary is the one that would turn a pure
  // decision into an execution. The specific risk it carries is *reaching past*
  // the domain into an adapter or an authorization decision of its own.
  describe('STEP 72 trip execution qualified dispatch', () => {
    const TRIP_EXECUTION_QUALIFIED_DISPATCH =
      'services/tripExecution/tripExecutionQualifiedDispatch.ts';

    it('imports only pure domain and pure execution-domain contracts', () => {
      const source = readSource(TRIP_EXECUTION_QUALIFIED_DISPATCH);
      const imports = [
        ...source.matchAll(/import\s+((?:type\s+)?)([\s\S]*?)\s+from\s+'([^']+)';/g),
      ].map((match) => ({ typeOnly: match[1].trim().startsWith('type'), module: match[3] }));
      expect(imports).toEqual([
        { typeOnly: false, module: '../../domain/providers/providerResults' },
        { typeOnly: false, module: '../../domain/providers/providerCapabilities' },
        { typeOnly: false, module: '../../domain/trips/tripPlanningExecutionRequest' },
        { typeOnly: false, module: '../../domain/trips/tripPlanningExecutionAuthorization' },
        // The dispatch *factory* and validator: the existing contract, reused.
        { typeOnly: false, module: './tripExecutionDispatch' },
        // The identity prefix only - no adapter, no provider contract.
        { typeOnly: false, module: './tripExecutionProvider' },
        { typeOnly: false, module: './tripExecutionPlan' },
        { typeOnly: false, module: './tripExecutionPlanQualification' },
      ]);
    });

    it('never reaches an execution, orchestration, or pipeline path', () => {
      const code = readCode(TRIP_EXECUTION_QUALIFIED_DISPATCH);
      for (const forbidden of [
        'tripExecutionOrchestrator',
        'tripExecutionPipeline',
        'orchestrateTripExecution',
        'executeTripExecutionPipeline',
        'mockTripExecutionProvider',
        'createTripExecutionProviderRequest',
        'isTripExecutionProviderRequest',
      ]) {
        expect(code, forbidden).not.toContain(forbidden);
      }
      expect(code).not.toMatch(/\.execute\s*\(/);
      expect(code).not.toMatch(/TripExecutionProvider\b/);
    });

    it('reaches no server, network, or persistence layer', () => {
      const code = readCode(TRIP_EXECUTION_QUALIFIED_DISPATCH);
      expect(code).not.toMatch(/serverBoundary|serverExecution|realExecution/i);
      expect(code).not.toMatch(/fetch\s*\(|XMLHttpRequest|axios|httpsCallable|getFunctions/);
      expect(code).not.toMatch(/firebase|firestore|addDoc|setDoc/i);
      expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    });

    it('stays pure: no asynchrony, clock, environment, or global mutable state', () => {
      const code = readCode(TRIP_EXECUTION_QUALIFIED_DISPATCH);
      expect(code).not.toMatch(/\basync\b|\bawait\b|\bPromise\b/);
      expect(code).not.toMatch(/setTimeout|setInterval/);
      expect(code).not.toMatch(/Date\.now\(|new\s+Date\(\s*\)|Math\.random/);
      expect(code).not.toMatch(/import\.meta\.env|process\.env/);
      expect(code).not.toMatch(/^(let|var)\s/m);
      expect(code).not.toMatch(/class\s+\w+/);
    });

    it('reaches no UI, React, Router, or Zustand layer', () => {
      const code = readCode(TRIP_EXECUTION_QUALIFIED_DISPATCH);
      for (const forbidden of ['react', 'react-dom', 'react-router', 'zustand']) {
        expect(code).not.toMatch(new RegExp(`from\\s+['"]${forbidden}`));
      }
      expect(code).not.toMatch(/\bwindow\.|\bdocument\.|\bnavigator\./);
    });

    it('invents no booking, payment, or execution capability', () => {
      const source = readSource(TRIP_EXECUTION_QUALIFIED_DISPATCH);
      for (const invented of [
        'flight-booking',
        'hotel-booking',
        'payment',
        'charge-card',
        'purchase',
        'ticket-purchase',
        'refund',
        'reservation',
      ]) {
        expect(source, invented).not.toContain(`'${invented}'`);
      }
      // The capability vocabulary stays owned by the provider domain.
      expect(source).not.toMatch(
        /export (?:const|type) (?:PROVIDER_CAPABILITY_IDS|ProviderCapabilityId)/
      );
    });

    it('does not sort, rank, or score providers', () => {
      const code = readCode(TRIP_EXECUTION_QUALIFIED_DISPATCH);
      expect(code).not.toMatch(/\.sort\s*\(|\.reverse\s*\(|\.flat\s*\(/);
      expect(code).not.toMatch(/\b(rank|score|bestProvider|preferred)\b/i);
    });

    it('redistributes the existing STEP 58 contract instead of restating it', () => {
      const source = readSource(TRIP_EXECUTION_QUALIFIED_DISPATCH);
      // The dispatch id formula and the instruction kind belong to STEP 58.
      // Redeclaring either here would fork the contract.
      expect(source).not.toMatch(/export const TRIP_EXECUTION_DISPATCH/);
      expect(source).not.toContain("'trip-execution-dispatch-instruction'");
      // The authorization is re-derived with the real STEP 57 function and the
      // instruction is built by the real STEP 58 factory, never by hand.
      const code = readCode(TRIP_EXECUTION_QUALIFIED_DISPATCH);
      expect(code).toContain('getTripPlanningExecutionAuthorizationId');
      expect(code).toContain('isTripPlanningExecutionAuthorization');
      expect(code).toContain('createTripExecutionDispatchInstruction');
      expect(code).toContain('isTripExecutionDispatchInstruction');
      expect(code).not.toMatch(/authorizationId:\s*['"`]/);
    });

    it('invents no authorization semantics of its own', () => {
      const code = readCode(TRIP_EXECUTION_QUALIFIED_DISPATCH);
      // No policy, session, role, expiry, or existence check: those are STEP 57's
      // own documented scope, delegated to a later layer.
      expect(code).not.toMatch(/\b(role|policy|permission|scope|token|credential|session)\b/i);
      expect(code).not.toMatch(/expires|expiry|validUntil|revoked/);
      // No existence lookup, so it cannot claim a referenced value is present.
      expect(code).not.toMatch(/exists|lookup|findBy|fetch\(/i);
    });
  });

  // STEP 73: authorization handoff. This is the one module permitted to hand
  // back a real STEP 57 authorization, so the boundary that matters most is that
  // it recovers an identity without *becoming* an authorization system, and
  // without forking the STEP 57 or STEP 58 contracts it depends on.
  describe('STEP 73 trip execution qualified authorization', () => {
    const TRIP_EXECUTION_QUALIFIED_AUTHORIZATION =
      'services/tripExecution/tripExecutionQualifiedAuthorization.ts';

    it('imports only pure domain and pure execution-domain contracts', () => {
      const source = readSource(TRIP_EXECUTION_QUALIFIED_AUTHORIZATION);
      const imports = [
        ...source.matchAll(/import\s+((?:type\s+)?)([\s\S]*?)\s+from\s+'([^']+)';/g),
      ].map((match) => ({ typeOnly: match[1].trim().startsWith('type'), module: match[3] }));
      expect(imports).toEqual([
        { typeOnly: false, module: '../../domain/providers/providerResults' },
        { typeOnly: false, module: '../../domain/providers/providerCapabilities' },
        // The real request validator, so the STEP 57 factory is handed a value
        // it genuinely accepts rather than a shortcut object.
        { typeOnly: false, module: '../../domain/trips/tripPlanningExecutionRequest' },
        { typeOnly: false, module: '../../domain/trips/tripPlanningExecutionAuthorization' },
        // The STEP 58 factory, validator, and id function.
        { typeOnly: false, module: './tripExecutionDispatch' },
        // The identity prefix only: no provider request or adapter.
        { typeOnly: false, module: './tripExecutionProvider' },
        { typeOnly: false, module: './tripExecutionPlan' },
        { typeOnly: false, module: './tripExecutionQualifiedDispatch' },
      ]);
    });

    it('never reaches an execution, orchestration, or pipeline path', () => {
      const code = readCode(TRIP_EXECUTION_QUALIFIED_AUTHORIZATION);
      for (const forbidden of [
        'tripExecutionOrchestrator',
        'tripExecutionPipeline',
        'orchestrateTripExecution',
        'executeTripExecutionPipeline',
        'mockTripExecutionProvider',
        'createTripExecutionProviderRequest',
        'isTripExecutionProviderRequest',
      ]) {
        expect(code, forbidden).not.toContain(forbidden);
      }
      expect(code).not.toMatch(/\.execute\s*\(/);
      expect(code).not.toMatch(/TripExecutionProvider\b/);
    });

    it('reaches no server, network, or persistence layer', () => {
      const code = readCode(TRIP_EXECUTION_QUALIFIED_AUTHORIZATION);
      expect(code).not.toMatch(/serverBoundary|serverExecution|realExecution/i);
      expect(code).not.toMatch(/fetch\s*\(|XMLHttpRequest|axios|httpsCallable|getFunctions/);
      expect(code).not.toMatch(/firebase|firestore|addDoc|setDoc/i);
      expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    });

    it('stays pure: no asynchrony, clock, environment, or global mutable state', () => {
      const code = readCode(TRIP_EXECUTION_QUALIFIED_AUTHORIZATION);
      expect(code).not.toMatch(/\basync\b|\bawait\b|\bPromise\b/);
      expect(code).not.toMatch(/setTimeout|setInterval/);
      expect(code).not.toMatch(/Date\.now\(|new\s+Date\(\s*\)|Math\.random/);
      expect(code).not.toMatch(/import\.meta\.env|process\.env/);
      expect(code).not.toMatch(/^(let|var)\s/m);
      expect(code).not.toMatch(/class\s+\w+/);
    });

    it('reaches no UI, React, Router, or Zustand layer', () => {
      const code = readCode(TRIP_EXECUTION_QUALIFIED_AUTHORIZATION);
      for (const forbidden of ['react', 'react-dom', 'react-router', 'zustand']) {
        expect(code).not.toMatch(new RegExp(`from\\s+['"]${forbidden}`));
      }
      expect(code).not.toMatch(/\bwindow\.|\bdocument\.|\bnavigator\./);
    });

    it('invents no booking, payment, or execution capability', () => {
      const source = readSource(TRIP_EXECUTION_QUALIFIED_AUTHORIZATION);
      for (const invented of [
        'flight-booking',
        'hotel-booking',
        'payment',
        'charge-card',
        'purchase',
        'ticket-purchase',
        'refund',
        'reservation',
      ]) {
        expect(source, invented).not.toContain(`'${invented}'`);
      }
      expect(source).not.toMatch(
        /export (?:const|type) (?:PROVIDER_CAPABILITY_IDS|ProviderCapabilityId)/
      );
    });

    it('does not sort, rank, or score providers', () => {
      const code = readCode(TRIP_EXECUTION_QUALIFIED_AUTHORIZATION);
      expect(code).not.toMatch(/\.sort\s*\(|\.reverse\s*\(|\.flat\s*\(/);
      expect(code).not.toMatch(/\b(rank|score|bestProvider|preferred)\b/i);
    });

    it('reuses the STEP 57 and STEP 58 contracts instead of restating them', () => {
      const source = readSource(TRIP_EXECUTION_QUALIFIED_AUTHORIZATION);
      const code = readCode(TRIP_EXECUTION_QUALIFIED_AUTHORIZATION);
      // The real factory and validators are called, and the chain is re-derived
      // forward with STEP 58's own id function.
      expect(code).toContain('createTripPlanningExecutionAuthorization');
      expect(code).toContain('isTripPlanningExecutionAuthorization');
      expect(code).toContain('isTripPlanningExecutionRequest');
      expect(code).toContain('isTripExecutionDispatchInstruction');
      expect(code).toContain('getTripExecutionDispatchId');
      // No id, kind, or formula is redeclared here.
      expect(source).not.toMatch(/export const TRIP_PLANNING_EXECUTION_(?:AUTHORIZATION|REQUEST)/);
      expect(source).not.toMatch(/export const TRIP_EXECUTION_DISPATCH/);
      expect(source).not.toMatch(/export function getTripPlanningExecution/);
      expect(source).not.toMatch(/export function getTripExecutionDispatchId/);
      // No authorization is constructed by hand, and none is ever written as a
      // literal.
      expect(code).not.toMatch(/trip-planning-execution-authorization/);
      expect(code).not.toMatch(/trip-execution-dispatch:/);
    });

    it('does not become an authorization system', () => {
      const code = readCode(TRIP_EXECUTION_QUALIFIED_AUTHORIZATION);
      // Recovering an identity is not a permission decision. No policy, role,
      // scope, session, or expiry evaluation, and no existence lookup.
      expect(code).not.toMatch(/\b(role|policy|permission|scope|token|credential|session|consent)\b/i);
      expect(code).not.toMatch(/expires|expiry|validUntil|revoked|approvedBy/);
      expect(code).not.toMatch(/exists|lookup|findBy|getDoc|query\(/i);
    });
  });

  // STEP 74: authorized-execution to provider-request handoff. This is the one
  // module permitted to build the real STEP 59 provider request, so the boundary
  // that matters most is that it stops at the provider-neutral request value and
  // never crosses into an adapter.
  describe('STEP 74 trip execution authorized request', () => {
    const TRIP_EXECUTION_AUTHORIZED_REQUEST =
      'services/tripExecution/tripExecutionAuthorizedRequest.ts';

    it('imports only pure domain and pure execution-domain contracts', () => {
      const source = readSource(TRIP_EXECUTION_AUTHORIZED_REQUEST);
      const imports = [
        ...source.matchAll(/import\s+((?:type\s+)?)([\s\S]*?)\s+from\s+'([^']+)';/g),
      ].map((match) => ({ typeOnly: match[1].trim().startsWith('type'), module: match[3] }));
      expect(imports).toEqual([
        { typeOnly: false, module: '../../domain/providers/providerResults' },
        { typeOnly: false, module: '../../domain/providers/providerCapabilities' },
        // The real STEP 57 validator, so a recovered authorization is checked by
        // its own contract rather than by a local restatement.
        { typeOnly: false, module: '../../domain/trips/tripPlanningExecutionAuthorization' },
        // The real STEP 58 factory, validator, and prefix.
        { typeOnly: false, module: './tripExecutionDispatch' },
        // The real STEP 59 factory, validator, and id function.
        { typeOnly: false, module: './tripExecutionProvider' },
        { typeOnly: false, module: './tripExecutionPlan' },
        // The STEP 73 result contract.
        { typeOnly: false, module: './tripExecutionQualifiedAuthorization' },
      ]);
    });

    it('never reaches an execution, orchestration, or pipeline path', () => {
      const code = readCode(TRIP_EXECUTION_AUTHORIZED_REQUEST);
      for (const forbidden of [
        'tripExecutionOrchestrator',
        'tripExecutionPipeline',
        'orchestrateTripExecution',
        'executeTripExecutionPipeline',
        'mockTripExecutionProvider',
        'tripExecutionPlanBinding',
      ]) {
        expect(code, forbidden).not.toContain(forbidden);
      }
      expect(code).not.toMatch(/\.execute\s*\(/);
      // The adapter interface itself, not the request type it shares a prefix with.
      expect(code).not.toMatch(/\bTripExecutionProvider\b/);
    });

    it('reaches no server, network, or persistence layer', () => {
      const code = readCode(TRIP_EXECUTION_AUTHORIZED_REQUEST);
      expect(code).not.toMatch(/serverBoundary|serverExecution|realExecution/i);
      expect(code).not.toMatch(/fetch\s*\(|XMLHttpRequest|axios|httpsCallable|getFunctions/);
      expect(code).not.toMatch(/firebase|firestore|addDoc|setDoc/i);
      expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    });

    it('stays pure: no asynchrony, clock, environment, or global mutable state', () => {
      const code = readCode(TRIP_EXECUTION_AUTHORIZED_REQUEST);
      expect(code).not.toMatch(/\basync\b|\bawait\b|\bPromise\b/);
      expect(code).not.toMatch(/setTimeout|setInterval/);
      expect(code).not.toMatch(/Date\.now\(|new\s+Date\(\s*\)|Math\.random/);
      expect(code).not.toMatch(/import\.meta\.env|process\.env/);
      expect(code).not.toMatch(/^(let|var)\s/m);
      expect(code).not.toMatch(/class\s+\w+/);
    });

    it('reaches no UI, React, Router, or Zustand layer', () => {
      const code = readCode(TRIP_EXECUTION_AUTHORIZED_REQUEST);
      for (const forbidden of ['react', 'react-dom', 'react-router', 'zustand']) {
        expect(code).not.toMatch(new RegExp(`from\\s+['"]${forbidden}`));
      }
      expect(code).not.toMatch(/\bwindow\.|\bdocument\.|\bnavigator\./);
    });

    it('invents no booking, payment, reservation, or cancellation capability', () => {
      const source = readSource(TRIP_EXECUTION_AUTHORIZED_REQUEST);
      for (const invented of [
        'flight-booking',
        'hotel-booking',
        'payment',
        'charge-card',
        'purchase',
        'ticket-purchase',
        'refund',
        'reservation',
        'cancellation',
      ]) {
        // Neither the code nor any string literal may contain one.
        for (const literal of source.match(/'[^'\n]*'/g) ?? []) {
          expect(literal, `${invented} in ${literal}`).not.toContain(invented);
        }
      }
      // The closed capability vocabulary is not redeclared or re-exported here.
      expect(source).not.toMatch(/export (?:const|type) (?:PROVIDER_CAPABILITY_IDS|ProviderCapabilityId)/);
      expect(source).not.toMatch(/ProviderCapabilityDeclaration/);
    });

    it('does not sort, rank, or score providers, and creates no registry', () => {
      const code = readCode(TRIP_EXECUTION_AUTHORIZED_REQUEST);
      expect(code).not.toMatch(/\.sort\s*\(|\.reverse\s*\(|\.flat\s*\(/);
      expect(code).not.toMatch(/\b(rank|score|bestProvider|preferred|topProvider)\b/i);
      expect(code).not.toMatch(/REGISTRY|Registry|registry/);
    });

    it('reuses the STEP 57, 58, and 59 contracts instead of restating them', () => {
      const source = readSource(TRIP_EXECUTION_AUTHORIZED_REQUEST);
      const code = readCode(TRIP_EXECUTION_AUTHORIZED_REQUEST);
      // The real validators and factories are called.
      expect(code).toContain('isTripPlanningExecutionAuthorization');
      expect(code).toContain('createTripExecutionDispatchInstruction');
      expect(code).toContain('isTripExecutionDispatchInstruction');
      expect(code).toContain('createTripExecutionProviderRequest');
      expect(code).toContain('isTripExecutionProviderRequest');
      expect(code).toContain('getTripExecutionProviderRequestId');
      // No id, kind, request, or formula is redeclared here.
      expect(source).not.toMatch(/export const TRIP_EXECUTION_PROVIDER_REQUEST/);
      expect(source).not.toMatch(/export const TRIP_EXECUTION_DISPATCH/);
      expect(source).not.toMatch(/export const TRIP_PLANNING_EXECUTION_AUTHORIZATION/);
      expect(source).not.toMatch(/export function getTripExecutionProviderRequestId/);
      expect(source).not.toMatch(/export function getTripExecutionDispatchId/);
      expect(source).not.toMatch(/export interface TripExecutionProviderRequest/);
      // No provider request is constructed by hand, and no id is written as a
      // literal.
      expect(code).not.toMatch(/\{[^{}]*kind:\s*TRIP_EXECUTION_PROVIDER_REQUEST_KIND/);
      expect(code).not.toMatch(/trip-execution-provider-request/);
      expect(code).not.toMatch(/trip-execution-dispatch:/);
      // And no STEP 59 result status is emitted: those describe a provider's
      // answer, and no provider has been asked.
      expect(code).not.toMatch(/\bstatus:/);
    });
  });

  // STEP 75: the authorized-execution boundary. This is the one production module
  // permitted to call `provider.execute()`, so the boundary that matters most is
  // the *narrowness* of that permission: it must call the supplied provider
  // exactly once and stop, with no orchestrator behind it, no provider of its own,
  // no retry, and no commerce semantics attached to any status.
  describe('STEP 75 trip execution authorized execution', () => {
    const TRIP_EXECUTION_AUTHORIZED_EXECUTION =
      'services/tripExecution/tripExecutionAuthorizedExecution.ts';

    it('imports only the STEP 59 contract, the STEP 74 vocabulary, and the shared identity bound', () => {
      const source = readSource(TRIP_EXECUTION_AUTHORIZED_EXECUTION);
      const imports = [
        ...source.matchAll(/import\s+((?:type\s+)?)([\s\S]*?)\s+from\s+'([^']+)';/g),
      ].map((match) => ({ typeOnly: match[1].trim().startsWith('type'), module: match[3] }));
      expect(imports).toEqual([
        // The same bound STEP 59's own provider-identity rule reads, so the
        // module invents no second notion of a legal provider id.
        { typeOnly: false, module: '../../domain/providers/providerResults' },
        // The real STEP 59 request type, result type, and both validators.
        { typeOnly: false, module: './tripExecutionProvider' },
        // The STEP 74 reason vocabulary, used to check that an affirmative
        // verdict is the affirmative token and not a look-alike.
        { typeOnly: false, module: './tripExecutionAuthorizedRequest' },
      ]);
      // No authorization, dispatch, plan, qualification, or capability layer is
      // reachable from here: nothing upstream is re-entered.
      for (const upstream of [
        'tripPlanningExecutionAuthorization',
        'tripExecutionDispatch',
        'tripExecutionPlan',
        'tripExecutionPlanQualification',
        'tripExecutionQualifiedDispatch',
        'tripExecutionQualifiedAuthorization',
      ]) {
        expect(source, upstream).not.toContain(upstream);
      }
    });

    it('calls the supplied provider exactly once and creates no provider', () => {
      const code = readCode(TRIP_EXECUTION_AUTHORIZED_EXECUTION);
      const source = readSource(TRIP_EXECUTION_AUTHORIZED_EXECUTION);
      // Exactly one call site, and it is the call the contract authorises.
      expect([...code.matchAll(/\.execute\s*\(/g)].length).toBe(1);
      expect(code).toContain('provider.execute(providerRequest)');
      // No provider is discovered, imported, constructed, or selected.
      expect(source).not.toMatch(/mockTripExecutionProvider|MOCK_TRIP_EXECUTION_PROVIDER_ID/);
      expect(code).not.toMatch(/\bnew\s+\w+/);
      for (const forbidden of [
        'amadeus',
        'google',
        'realDiscovery',
        'realExecution',
        'serverBoundary',
        'discover',
        'select',
        'rank',
        'Registry',
        'registry',
      ]) {
        expect(code, forbidden).not.toMatch(new RegExp(forbidden, 'i'));
      }
    });

    it('does not become an orchestrator: no selection, aggregation, or fallback', () => {
      const source = readSource(TRIP_EXECUTION_AUTHORIZED_EXECUTION);
      const code = readCode(TRIP_EXECUTION_AUTHORIZED_EXECUTION);
      expect(source).not.toMatch(/tripExecutionOrchestrator|tripExecutionPipeline/);
      expect(code).not.toMatch(/\b(orchestrate|pipeline|aggregate|fallback|choose|dedupe)\w*/i);
      // No provider collection is ever accepted or iterated: the input is a single
      // request and a single provider.
      expect(source).not.toMatch(/TripExecutionProvider\[\]/);
      expect(source).not.toMatch(/readonly TripExecutionProvider\[\]|providers: readonly/);
      // `.every` is the shape gate confirming every qualified id is a legal
      // identity - a boolean over the list, never a choice. No method that
      // reorders, narrows, or picks a member is present.
      expect(code).not.toMatch(/\.forEach\s*\(|\.map\s*\(|\.filter\s*\(|\.reduce\s*\(/);
      expect(code).not.toMatch(/\.sort\s*\(|\.reverse\s*\(|\.find\s*\(|\.findIndex\s*\(/);
      expect(code).not.toMatch(/\.shift\s*\(|\.pop\s*\(|\.slice\s*\(/);
      // An aggregate status is never computed from a single answer.
      expect(code).not.toMatch(/everyProvider|allProviders|overallStatus|anyAccepted/);
    });

    it('never reaches a server, network, or persistence layer', () => {
      const code = readCode(TRIP_EXECUTION_AUTHORIZED_EXECUTION);
      expect(code).not.toMatch(/serverBoundary|serverExecution|serverDiscoveryClient/i);
      expect(code).not.toMatch(/fetch\s*\(|XMLHttpRequest|axios|httpsCallable|getFunctions/);
      expect(code).not.toMatch(/firebase|firestore|addDoc|setDoc|updateDoc|writeBatch/i);
      expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
      // The single `await` in the file awaits the provider, and the single `try`
      // guards that one call. No other asynchrony is introduced.
      expect([...code.matchAll(/\bawait\b/g)].length).toBe(1);
      expect([...code.matchAll(/\btry\s*\{/g)].length).toBe(1);
    });

    it('reaches no UI, React, Router, or Zustand layer', () => {
      const code = readCode(TRIP_EXECUTION_AUTHORIZED_EXECUTION);
      for (const forbidden of ['react', 'react-dom', 'react-router', 'zustand']) {
        expect(code).not.toMatch(new RegExp(`from\\s+['"]${forbidden}`));
      }
      expect(code).not.toMatch(/\bwindow\.|\bdocument\.|\bnavigator\./);
    });

    it('stays deterministic: no clock, environment, retry, or timer', () => {
      const code = readCode(TRIP_EXECUTION_AUTHORIZED_EXECUTION);
      expect(code).not.toMatch(/setTimeout|setInterval|clearTimeout|clearInterval/);
      expect(code).not.toMatch(/Date\.now\(|new\s+Date\s*\(|Math\.random|performance\./);
      expect(code).not.toMatch(/import\.meta\.env|process\.env|Deno\.env/);
      expect(code).not.toMatch(/\bglobalThis\b|\bmodule\s*\.\s*exports/);
      // No retry mechanism of any kind, and no loop to drive one.
      expect(code).not.toMatch(/retry|backoff|attempt|\bwhile\s*\(|\bfor\s*\(/i);
      expect(code).not.toMatch(/Promise\.(all|race|allSettled|any)/);
      // No module-level mutable state: the only `let` is the function-local that
      // receives the provider's answer.
      expect(code).not.toMatch(/^(let|var)\s/m);
      expect([...code.matchAll(/\blet\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1])).toEqual(['raw']);
      expect(code).not.toMatch(/class\s+\w+/);
    });

    it('invents no booking, payment, reservation, or cancellation semantics', () => {
      const source = readSource(TRIP_EXECUTION_AUTHORIZED_EXECUTION);
      const code = readCode(TRIP_EXECUTION_AUTHORIZED_EXECUTION);
      for (const invented of [
        'booking',
        'booked',
        'payment',
        'purchase',
        'reservation',
        'reserve',
        'ticket',
        'invoice',
        'refund',
        'cancellation',
        'confirmation',
        'price',
        'currency',
      ]) {
        // Neither the code nor any string literal may contain one. The reason
        // vocabulary is the surface a caller reads, so a commerce word there
        // would be a promise this module does not keep.
        expect(code, invented).not.toMatch(new RegExp(invented, 'i'));
        for (const literal of source.match(/'[^'\n]*'/g) ?? []) {
          expect(literal, `${invented} in ${literal}`).not.toMatch(new RegExp(invented, 'i'));
        }
      }
      // No capability vocabulary is declared, re-exported, or invented here: the
      // boundary says nothing about support beyond the provider's own answer.
      expect(source).not.toMatch(/export (?:const|type) (?:PROVIDER_CAPABILITY_IDS|ProviderCapabilityId)/);
      expect(source).not.toMatch(/providerCapabilities/);
      expect(source).not.toMatch(/\.supports\s*\(/);
      expect(source).not.toMatch(/requiredCapabilityId|capabilityIds/);
    });

    it('reuses the STEP 59 contract instead of restating it', () => {
      const source = readSource(TRIP_EXECUTION_AUTHORIZED_EXECUTION);
      const code = readCode(TRIP_EXECUTION_AUTHORIZED_EXECUTION);
      // The real validators are called for both the request and the answer.
      expect(code).toContain('isTripExecutionProviderRequest');
      expect(code).toContain('isTripExecutionProviderResult');
      // No STEP 59 id, kind, prefix, or status vocabulary is redeclared, and no
      // provider result is constructed here: a result exists only if the
      // provider returned one.
      expect(source).not.toMatch(/export const TRIP_EXECUTION_PROVIDER_REQUEST/);
      expect(source).not.toMatch(/TRIP_EXECUTION_PROVIDER_RESULT_STATUSES/);
      expect(source).not.toMatch(/export interface TripExecutionProviderResult/);
      expect(source).not.toMatch(/export interface TripExecutionProvider\b/);
      expect(code).not.toMatch(/status:\s*['"]/);
      // And no provider identity is constructed: the only `providerId` writes are
      // the two result-field type declarations and the one success-path copy of
      // the supplied provider's own identity. No literal, no derivation, no
      // normalisation, and no lookup.
      const providerIdWrites = [...code.matchAll(/providerId\s*:\s*([^;\n,}]+)/g)].map((m) =>
        m[1].trim()
      );
      expect(providerIdWrites).toEqual([
        'string | null',
        'string | null',
        'provider.providerId',
      ]);
      expect(code).not.toMatch(/getTripExecutionProviderId|providerId\s*=\s*[^=]/);
    });
  });

  // STEP 76: the multi-provider orchestration boundary. The architectural
  // invariant under test is that there is exactly ONE route from an authorized
  // request to a provider: STEP 74 -> STEP 76 -> STEP 75 -> STEP 59 execute().
  // So the checks that matter most are negative - no `execute(` call site here,
  // no import of STEP 61's or STEP 65's execution path, and no retry, concurrency,
  // or timer that could turn one authorized attempt into several.
  describe('STEP 76 trip execution authorized orchestrator', () => {
    const TRIP_EXECUTION_AUTHORIZED_ORCHESTRATOR =
      'services/tripExecution/tripExecutionAuthorizedOrchestrator.ts';
    const TRIP_EXECUTION_AUTHORIZED_EXECUTION =
      'services/tripExecution/tripExecutionAuthorizedExecution.ts';

    it('imports only the STEP 59 contract, STEP 74, STEP 75, and the pure STEP 61 aggregate', () => {
      const source = readSource(TRIP_EXECUTION_AUTHORIZED_ORCHESTRATOR);
      const imports = [
        ...source.matchAll(/import\s+((?:type\s+)?)([\s\S]*?)\s+from\s+'([^']+)';/g),
      ].map((match) => ({ typeOnly: match[1].trim().startsWith('type'), module: match[3] }));
      expect(imports).toEqual([
        // The same identity bound STEP 59's own rule reads.
        { typeOnly: false, module: '../../domain/providers/providerResults' },
        // The real STEP 59 request type, result types, and request validator.
        { typeOnly: false, module: './tripExecutionProvider' },
        // The STEP 74 reason vocabulary. STEP 74's own executor is not imported.
        { typeOnly: false, module: './tripExecutionAuthorizedRequest' },
        // The STEP 75 single-provider execution boundary: the only new route.
        { typeOnly: false, module: './tripExecutionAuthorizedExecution' },
        // STEP 61, for its PURE status calculation only. Its execution function is
        // not imported, so nothing here can reach a provider through it.
        { typeOnly: false, module: './tripExecutionOrchestrator' },
      ]);
      // No upstream execution-domain layer is reachable from here.
      for (const upstream of [
        'tripPlanningExecutionAuthorization',
        'tripExecutionDispatch',
        'tripExecutionPlan',
        'tripExecutionPlanQualification',
        'tripExecutionQualifiedDispatch',
        'tripExecutionQualifiedAuthorization',
      ]) {
        expect(source, upstream).not.toContain(upstream);
      }
    });

    it('has no direct provider execution: STEP 75 is the only route', () => {
      const code = readCode(TRIP_EXECUTION_AUTHORIZED_ORCHESTRATOR);
      // The critical invariant, asserted twice: no `.execute(` call site at all.
      expect(code).not.toMatch(/\.execute\s*\(/);
      expect(code).not.toMatch(/execute\s*\(/);
      expect(code).not.toMatch(/provider\s*\.\s*execute/);
      // STEP 75 is imported and called by name, exactly once per provider.
      expect(code).toContain('executeTripExecutionAuthorizedRequest');
      expect([...code.matchAll(/executeTripExecutionAuthorizedRequest\s*\(/g)].length).toBe(1);
      expect([...code.matchAll(/\bawait\b/g)].length).toBe(1);
      // And across the whole execution domain, only STEP 60 and STEP 61 invoke a
      // provider. STEP 76 is absent, so it added no route to a provider.
      const files = listDir('services/tripExecution');
      const invoked = files.filter((file) =>
        /\.execute\s*\(/.test(
          readSource(file)
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/\/\/[^\n]*/g, ' ')
        )
      );
      expect(invoked.map((file) => file.split(/[\\/]/).pop())).toEqual([
        'tripExecutionAuthorizedExecution.ts',
        'tripExecutionOrchestrator.ts',
      ]);
    });

    it('bypasses neither the STEP 61 execution path nor the STEP 65 pipeline', () => {
      const source = readSource(TRIP_EXECUTION_AUTHORIZED_ORCHESTRATOR);
      const code = readCode(TRIP_EXECUTION_AUTHORIZED_ORCHESTRATOR);
      // STEP 61's pure aggregate is reused; its executor is not, and its private
      // per-provider execution helper is not reimplemented here either.
      expect(code).toContain('getTripExecutionAggregateStatus');
      expect(code).not.toMatch(/\borchestrateTripExecution\s*\(/);
      expect(code).not.toMatch(/\bexecuteProviderSafely\b|\bisExecutionProvider\b/);
      expect(code).not.toMatch(/TripExecutionProviderAggregate/);
      // STEP 65 would be a second, unauthorized route to a provider.
      expect(source).not.toContain('tripExecutionPipeline');
      expect(code).not.toMatch(/pipeline|Pipeline/);
      // Neither module is imported for anything but the status calculation.
      expect(source).not.toMatch(/from\s+'[^']*tripExecutionPipeline/);
    });

    it('never reaches a server, network, or persistence layer', () => {
      const code = readCode(TRIP_EXECUTION_AUTHORIZED_ORCHESTRATOR);
      expect(code).not.toMatch(/serverBoundary|serverExecution|serverDiscoveryClient|realExecution|realDiscovery/i);
      expect(code).not.toMatch(/fetch\s*\(|XMLHttpRequest|axios|httpsCallable|getFunctions/);
      expect(code).not.toMatch(/firebase|firestore|addDoc|setDoc|updateDoc|writeBatch/i);
      expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
      // Real providers own their own network behaviour; this module has none.
      expect(code).not.toMatch(/\bhttps?:/);
    });

    it('reaches no UI, React, Router, or Zustand layer', () => {
      const code = readCode(TRIP_EXECUTION_AUTHORIZED_ORCHESTRATOR);
      for (const forbidden of ['react', 'react-dom', 'react-router', 'zustand']) {
        expect(code).not.toMatch(new RegExp(`from\\s+['"]${forbidden}`));
      }
      expect(code).not.toMatch(/\bwindow\.|\bdocument\.|\bnavigator\./);
    });

    it('stays deterministic: sequential, no retry, timer, or concurrency', () => {
      const code = readCode(TRIP_EXECUTION_AUTHORIZED_ORCHESTRATOR);
      // Sequential only. Concurrency would make the execution trace - and any
      // aggregate derived from it - non-deterministic.
      expect(code).not.toMatch(/Promise\.(all|race|allSettled|any)/);
      expect(code).not.toMatch(/\bwhile\s*\(/);
      expect(code).not.toMatch(/\bbreak\b|\bcontinue\b/);
      // No loop opens after the single await, so the execution loop cannot retry.
      const awaitIndex = code.indexOf('await ');
      expect(awaitIndex).toBeGreaterThan(-1);
      expect(code.slice(awaitIndex)).not.toMatch(/\bfor\s*\(/);
      // No timer, no clock, no environment, no retry vocabulary, no credential.
      expect(code).not.toMatch(/setTimeout|setInterval|clearTimeout|clearInterval/);
      expect(code).not.toMatch(/Date\.now\(|new\s+Date\s*\(|Math\.random|performance\./);
      expect(code).not.toMatch(/import\.meta\.env|process\.env|Deno\.env/);
      expect(code).not.toMatch(/retry|backoff|attempt|fallback/i);
      expect(code).not.toMatch(/credential|apiKey|clientSecret|API_KEY/);
      // No module-level mutable state: the only `let` declarations are the
      // function-local counters of the preflight and the result accumulators.
      expect(code).not.toMatch(/^(let|var)\s/m);
      expect([...code.matchAll(/\blet\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1])).toEqual(['index']);
      expect(code).not.toMatch(/class\s+\w+/);
    });

    it('invents no provider selection, ranking, substitution, or capability logic', () => {
      const source = readSource(TRIP_EXECUTION_AUTHORIZED_ORCHESTRATOR);
      const code = readCode(TRIP_EXECUTION_AUTHORIZED_ORCHESTRATOR);
      // No reordering or narrowing primitive: the STEP 74 order is authoritative
      // and the supplied collection is used in place, never reshaped.
      expect(code).not.toMatch(/\.sort\s*\(|\.reverse\s*\(|\.slice\s*\(/);
      expect(code).not.toMatch(/\.find\s*\(|\.findIndex\s*\(|\.flat\s*\(/);
      expect(code).not.toMatch(/\.filter\s*\(|\.reduce\s*\(/);
      // No ranking, scoring, discovery, or registry vocabulary.
      expect(code).not.toMatch(/\b(rank|score|prefer|best|top|priority|weight|recommend)\w*/i);
      expect(code).not.toMatch(/discover|registry|Registry|providerList|getProvider|resolveProvider/i);
      expect(code).not.toMatch(/\bnew\s+\w+/);
      // No capability evaluation, and no provider selection: the input is a
      // collection that must match the authorized set exactly, never narrowed.
      expect(code).not.toMatch(/\.supports\s*\(/);
      expect(code).not.toMatch(/providerCapabilities|PROVIDER_CAPABILITY_IDS/);
      expect(code).not.toMatch(/requiredCapabilityId|capabilityIds/);
      // The exported input takes an opaque `unknown`, so no caller can be handed
      // a narrower, already-selected provider type through this boundary.
      expect(source).toMatch(/providers:\s*unknown/);
      expect(source).toMatch(/request:\s*unknown/);
      // No aggregate status of its own invention: it reuses STEP 61's helper and
      // declares no new vocabulary.
      expect(code).not.toMatch(/status\s*:\s*['"]/);
      expect(source).not.toMatch(/TRIP_EXECUTION_PROVIDER_RESULT_STATUSES/);
      expect(source).not.toMatch(/export interface TripExecutionProviderResult/);
      expect(source).not.toMatch(/export interface TripExecutionProvider\b/);
    });

    it('invents no booking, payment, reservation, or cancellation semantics', () => {
      const source = readSource(TRIP_EXECUTION_AUTHORIZED_ORCHESTRATOR);
      const code = readCode(TRIP_EXECUTION_AUTHORIZED_ORCHESTRATOR);
      for (const invented of [
        'booking',
        'booked',
        'payment',
        'purchase',
        'reservation',
        'reserve',
        'ticket',
        'invoice',
        'refund',
        'cancellation',
        'confirmation',
        'price',
        'currency',
      ]) {
        expect(code, invented).not.toMatch(new RegExp(invented, 'i'));
        for (const literal of source.match(/'[^'\n]*'/g) ?? []) {
          expect(literal, `${invented} in ${literal}`).not.toMatch(new RegExp(invented, 'i'));
        }
      }
    });

    it('reuses the STEP 59 and STEP 74 contracts instead of restating them', () => {
      const source = readSource(TRIP_EXECUTION_AUTHORIZED_ORCHESTRATOR);
      const code = readCode(TRIP_EXECUTION_AUTHORIZED_ORCHESTRATOR);
      // The real STEP 59 request validator is called; result validation is STEP 75's
      // and STEP 61's job, so it is deliberately not restated here.
      expect(code).toContain('isTripExecutionProviderRequest');
      // No Step 59 id, kind, prefix, or status vocabulary is redeclared, and no
      // provider request or provider result is ever constructed here.
      expect(source).not.toMatch(/export const TRIP_EXECUTION_PROVIDER_REQUEST/);
      expect(source).not.toMatch(/TRIP_EXECUTION_PROVIDER_RESULT_STATUSES/);
      expect(source).not.toMatch(/export interface TripExecutionProviderRequest/);
      expect(source).not.toMatch(/export interface TripExecutionProviderResult/);
      expect(code).not.toMatch(/kind:\s*TRIP_EXECUTION_PROVIDER_REQUEST_KIND/);
      expect(code).not.toMatch(/trip-execution-provider-request|trip-execution-dispatch:/);
      // The STEP 59 result TYPE is imported and used only to read the aggregate,
      // never to build one.
      expect(source).toMatch(/TripExecutionProviderResult/);
      expect(code).not.toMatch(/status:\s*(?:'ok'|'error')/);
      // No provider identity is assigned, normalised, or substituted. The single
      // binding below only READS the supplied id; after removing declarations,
      // no `providerId =` remains anywhere.
      const withoutDeclarations = code.replace(/\b(?:const|let|var)\s+providerId\s*=/g, '');
      expect(withoutDeclarations).not.toMatch(/providerId\s*=\s*[^=]/);
      // No case folding or whitespace folding: an id is compared as exact bytes,
      // so 'Alpha' never matches 'alpha' and ' alpha ' never matches 'alpha'.
      expect(code).not.toMatch(/toLowerCase|toUpperCase|normalize|trimEnd|trimStart/);
      // `trim` appears only in the form that REJECTS a padded id rather than
      // silently repairing one.
      expect([...code.matchAll(/\.trim\(\)/g)].length).toBe(1);
      expect(code).toMatch(/if\s*\([^)]*!==[^)]*\.trim\(\)\)\s*return false/);
    });

    it('composes the same authorization gate STEP 75 applies, per provider', () => {
      // STEP 75 re-proves the request, the provider contract, and qualified-set
      // membership before every call. STEP 76 delegates rather than restating, so
      // the honest check is that the same object is handed to it each time.
      const step75Code = readCode(TRIP_EXECUTION_AUTHORIZED_EXECUTION);
      expect(step75Code).toContain('isTripExecutionProviderRequest');
      expect(step75Code).toContain('providerIds.includes(provider.providerId)');
      expect(step75Code).toContain('provider.execute(providerRequest)');
      // And STEP 76's own loop passes the request through unchanged.
      const code = readCode(TRIP_EXECUTION_AUTHORIZED_ORCHESTRATOR);
      expect(code).toMatch(/executeTripExecutionAuthorizedRequest\(\{\s*request,\s*provider,?\s*\}\)/);
      // It does not pre-validate what only STEP 75 can validate, and it does not
      // reach into the provider's methods either.
      expect(code).not.toMatch(/provider\.(execute|supports)\s*\(/);
    });
  });

  // STEP 77: the authorized execution outcome receipt. It is a record of work
  // that already happened, so the load-bearing checks are all negative - it
  // executes nothing, reaches nothing, and creates no second path to a provider.
  describe('STEP 77 trip execution outcome receipt', () => {
    const TRIP_EXECUTION_OUTCOME_RECEIPT =
      'services/tripExecution/tripExecutionOutcomeReceipt.ts';

    it('imports only types, vocabularies, and pure helpers', () => {
      const source = readSource(TRIP_EXECUTION_OUTCOME_RECEIPT);
      const imports = [
        ...source.matchAll(/import\s+((?:type\s+)?)([\s\S]*?)\s+from\s+'([^']+)';/g),
      ].map((match) => ({ typeOnly: match[1].trim().startsWith('type'), module: match[3] }));
      expect(imports).toEqual([
        // The same provider-identity bound the execution layers use.
        { typeOnly: false, module: '../../domain/providers/providerResults' },
        // STEP 59: the real result validator, the real status validator, the real
        // provider-request id prefix, and the two result types.
        { typeOnly: false, module: './tripExecutionProvider' },
        // STEP 76: its result TYPE and reason vocabulary. Its function is not here.
        { typeOnly: false, module: './tripExecutionAuthorizedOrchestrator' },
        // STEP 75: its result TYPE and reason vocabulary. Its function is not here.
        { typeOnly: false, module: './tripExecutionAuthorizedExecution' },
        // STEP 61, for its PURE aggregate calculation only.
        { typeOnly: false, module: './tripExecutionOrchestrator' },
      ]);
      // No execution function is imported at all, so no call can be made.
      for (const forbidden of [
        'executeTripExecutionAuthorizedRequest',
        'orchestrateTripExecutionAuthorizedRequest',
        'orchestrateTripExecution',
        'executeProviderSafely',
        'createTripExecutionAuthorizedRequest',
        'createTripExecutionProviderRequest',
        'createTripExecutionDispatchInstruction',
      ]) {
        expect(source, forbidden).not.toContain(forbidden);
      }
    });

    it('is not a provider execution path', () => {
      const code = readCode(TRIP_EXECUTION_OUTCOME_RECEIPT);
      expect(code).not.toMatch(/\.execute\s*\(/);
      expect(code).not.toMatch(/provider\s*\.\s*execute/);
      // No provider object is accepted as input: the single parameter is `unknown`.
      expect(code).toMatch(/createTripExecutionOutcomeReceipt\(\s*input:\s*unknown\s*\)/);
      expect(code).not.toMatch(/TripExecutionProvider\b/);
      // And across the whole execution domain, the two `.execute(` invocation
      // sites are unchanged: this file is not among them.
      const files = listDir('services/tripExecution');
      const invoked = files.filter((file) =>
        /\.execute\s*\(/.test(
          readSource(file)
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/\/\/[^\n]*/g, ' ')
        )
      );
      expect(invoked.map((file) => file.split(/[\\/]/).pop())).toEqual([
        'tripExecutionAuthorizedExecution.ts',
        'tripExecutionOrchestrator.ts',
      ]);
    });

    it('reaches no server, network, persistence, or UI layer', () => {
      const code = readCode(TRIP_EXECUTION_OUTCOME_RECEIPT);
      for (const forbidden of [
        'serverBoundary',
        'serverExecution',
        'serverDiscoveryClient',
        'realExecution',
        'realDiscovery',
      ]) {
        expect(code, forbidden).not.toMatch(new RegExp(forbidden, 'i'));
      }
      expect(code).not.toMatch(/fetch\s*\(|XMLHttpRequest|axios|httpsCallable|getFunctions/);
      expect(code).not.toMatch(/firebase|firestore|addDoc|setDoc|updateDoc|writeBatch/i);
      expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
      expect(code).not.toMatch(/node:fs|\bfs\.|readFile|writeFile/);
      for (const forbidden of ['react', 'react-dom', 'react-router', 'zustand']) {
        expect(code, forbidden).not.toMatch(new RegExp(`from\\s+['"]${forbidden}`));
      }
      expect(code).not.toMatch(/\bwindow\.|\bdocument\.|\bnavigator\./);
      expect(code).not.toMatch(/amadeus|google/i);
    });

    it('stays deterministic: no clock, randomness, or mutable state', () => {
      const code = readCode(TRIP_EXECUTION_OUTCOME_RECEIPT);
      expect(code).not.toMatch(/Date\.now\(|new\s+Date\s*\(|Math\.random|performance\./);
      expect(code).not.toMatch(/randomUUID|uuid|crypto\./i);
      expect(code).not.toMatch(/setTimeout|setInterval|clearTimeout|clearInterval/);
      expect(code).not.toMatch(/import\.meta\.env|process\.env|Deno\.env/);
      expect(code).not.toMatch(/credential|apiKey|clientSecret|API_KEY/);
      expect(code).not.toMatch(/Promise\.(all|race|allSettled|any)/);
      // No module-level mutable state, and no class.
      expect(code).not.toMatch(/^(let|var)\s/m);
      expect(code).not.toMatch(/class\s+\w+/);
    });

    it('invents no commerce or lifecycle semantics', () => {
      const source = readSource(TRIP_EXECUTION_OUTCOME_RECEIPT);
      const code = readCode(TRIP_EXECUTION_OUTCOME_RECEIPT);
      for (const invented of [
        'booking',
        'booked',
        'payment',
        'purchase',
        'reservation',
        'reserve',
        'ticket',
        'invoice',
        'refund',
        'cancellation',
        'confirmation',
        'transaction',
        'currency',
        'price',
      ]) {
        expect(code, invented).not.toMatch(new RegExp(invented, 'i'));
        for (const literal of source.match(/'[^'\n]*'/g) ?? []) {
          expect(literal, `${invented} in ${literal}`).not.toMatch(new RegExp(invented, 'i'));
        }
      }
    });

    it('declares no second status vocabulary and no second id formula', () => {
      const source = readSource(TRIP_EXECUTION_OUTCOME_RECEIPT);
      // `readCode` blanks template literals, so the id formula is checked against
      // a comment-stripped source that keeps them.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
      const bare = readCode(TRIP_EXECUTION_OUTCOME_RECEIPT);
      // The existing STEP 59 status vocabulary decides; nothing is redeclared.
      expect(code).toContain('isTripExecutionProviderResultStatus');
      expect(bare).toContain('getTripExecutionAggregateStatus');
      expect(source).not.toMatch(/TRIP_EXECUTION_PROVIDER_RESULT_STATUSES\s*=\s*\[/);
      expect(source).not.toMatch(/export const [A-Z_]*STATUS/);
      expect(source).not.toMatch(
        /'accepted'\s*,\s*'rejected'\s*,\s*'unsupported'\s*,\s*'failed'/
      );
      // The provider-request prefix is read from STEP 59, never restated.
      expect(source).not.toMatch(/'trip-execution-provider-request:'/);
      expect(bare).toContain('TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX');
      // The receipt prefix is declared exactly once and always used via the
      // constant, so there is a single id formula in the domain.
      expect([...source.matchAll(/'trip-execution-outcome-receipt:'/g)].length).toBe(1);
      expect(source).toContain('TRIP_EXECUTION_OUTCOME_RECEIPT_ID_PREFIX');
      // And it is built from the request identity, with no second derivation.
      expect(code).toMatch(/id:\s*`\$\{TRIP_EXECUTION_OUTCOME_RECEIPT_ID_PREFIX\}\$\{requestId\}`/);
      expect(code).not.toMatch(/id:\s*`[^`]*\$\{[^}]*(?:Date|random|counter)/i);
    });

    it('records rather than repairs, and interprets rather than rewrites', () => {
      const code = readCode(TRIP_EXECUTION_OUTCOME_RECEIPT);
      // No repairing: no trimming, case folding, sorting, or deduplication of ids.
      expect(code).not.toMatch(/toLowerCase|toUpperCase|normalize/);
      expect(code).not.toMatch(/\.sort\s*\(|\.reverse\s*\(/);
      expect(code).not.toMatch(/\bfilter\s*\(|\breduce\s*\(/);
      // The only `trim` is the form that refuses a padded id rather than fixing it.
      expect([...code.matchAll(/\.trim\(\)/g)].length).toBe(1);
      expect(code).toMatch(/if\s*\([^)]*!==[^)]*\.trim\(\)\)\s*return false/);
      // No rewriting of provider statuses, ids, or request ids. After declarations are
      // removed, no identity is ever assigned to.
      expect(code).not.toMatch(/status\s*=\s*['"](?:accepted|rejected|failed|unsupported)/);
      const assigned = code.replace(/\b(?:const|let|var)\s+(providerId|requestId)\s*=/g, '');
      expect(assigned).not.toMatch(/\b(providerId|requestId)\s*=\s*[^=]/);
      // No fabricating or merging of results. The single `new` is the duplicate check
      // in the guard, which inspects rather than builds anything.
      expect([...code.matchAll(/\bnew\s+(\w+)/g)].map((m) => m[1])).toEqual(['Set']);
      expect(code).not.toMatch(/\.\.\.results\.filter|mergeProvider/);
    });

    it('defensively copies rather than sharing mutable structure', () => {
      const code = readCode(TRIP_EXECUTION_OUTCOME_RECEIPT);
      // A fresh array for the provider set and a fresh array of fresh result
      // objects, so nothing mutable is shared in either direction.
      expect(code).toMatch(/providerIds:\s*\[\.\.\.providerIds\]/);
      expect(code).toMatch(/results:\s*results\.map\(/);
      expect(code).toMatch(/result:\s*result\.result === null \? null : \{ \.\.\.result\.result \}/);
      // And no general-purpose deep clone is pulled in for a three-field object.
      expect(code).not.toMatch(/structuredClone|JSON\.parse\(JSON\.stringify|\bclone\(/);
    });
  });
});
