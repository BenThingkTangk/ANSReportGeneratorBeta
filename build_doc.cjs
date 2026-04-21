// Build HumanOS ANS System Architecture .docx
const fs = require('fs');
const path = '/home/user/node_modules/docx';
const docx = require(path);

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, PageOrientation, LevelFormat,
  ExternalHyperlink, TableOfContents, HeadingLevel, BorderStyle,
  WidthType, ShadingType, VerticalAlign, PageNumber, PageBreak,
} = docx;

// ---- Design tokens ----
const TEAL = '20808D';
const TEXT = '28251D';
const MUTED = '7A7974';
const BORDER = 'D4D1CA';
const SURFACE = 'F7F6F2';
const CODE_BG = 'F2F1EC';

const thinBorder = { style: BorderStyle.SINGLE, size: 4, color: BORDER };
const allBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

// Page: US Letter, 1" margins
const PAGE_W = 12240;
const MARGIN = 1080; // 0.75"
const CONTENT_W = PAGE_W - MARGIN * 2; // 10080

// ---- Helpers ----
const p = (text, opts = {}) => new Paragraph({
  spacing: { after: 120, line: 300 },
  ...opts,
  children: Array.isArray(text)
    ? text
    : [new TextRun({ text, font: 'Calibri', size: 22, color: TEXT, ...(opts.runOpts || {}) })],
});

const body = (text) => new Paragraph({
  spacing: { after: 140, line: 300 },
  children: [new TextRun({ text, font: 'Calibri', size: 22, color: TEXT })],
});

const bodyRuns = (runs) => new Paragraph({
  spacing: { after: 140, line: 300 },
  children: runs,
});

const h1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  children: [new TextRun({ text, font: 'Calibri', size: 36, bold: true, color: TEAL })],
  spacing: { before: 360, after: 160 },
  pageBreakBefore: false,
});

const h1Break = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  children: [new TextRun({ text, font: 'Calibri', size: 36, bold: true, color: TEAL })],
  spacing: { before: 360, after: 160 },
  pageBreakBefore: true,
});

const h2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  children: [new TextRun({ text, font: 'Calibri', size: 28, bold: true, color: TEAL })],
  spacing: { before: 260, after: 120 },
});

const h3 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_3,
  children: [new TextRun({ text, font: 'Calibri', size: 24, bold: true, color: TEXT })],
  spacing: { before: 200, after: 80 },
});

const bullet = (text) => new Paragraph({
  numbering: { reference: 'bullets', level: 0 },
  spacing: { after: 60, line: 280 },
  children: [new TextRun({ text, font: 'Calibri', size: 22, color: TEXT })],
});

const bulletRuns = (runs) => new Paragraph({
  numbering: { reference: 'bullets', level: 0 },
  spacing: { after: 60, line: 280 },
  children: runs,
});

const codeLine = (text) => new Paragraph({
  spacing: { after: 0, line: 240 },
  shading: { fill: CODE_BG, type: ShadingType.CLEAR },
  children: [new TextRun({ text: text || ' ', font: 'Consolas', size: 18, color: TEXT })],
});

const codeBlock = (codeStr) => codeStr.split('\n').map(codeLine);

// Table builder
const headerCell = (text, width) => new TableCell({
  borders: allBorders,
  width: { size: width, type: WidthType.DXA },
  shading: { fill: TEAL, type: ShadingType.CLEAR },
  margins: { top: 100, bottom: 100, left: 120, right: 120 },
  verticalAlign: VerticalAlign.CENTER,
  children: [new Paragraph({
    children: [new TextRun({ text, font: 'Calibri', size: 20, bold: true, color: 'FFFFFF' })],
  })],
});

const dataCell = (text, width, opts = {}) => new TableCell({
  borders: allBorders,
  width: { size: width, type: WidthType.DXA },
  shading: opts.alt ? { fill: SURFACE, type: ShadingType.CLEAR } : undefined,
  margins: { top: 80, bottom: 80, left: 120, right: 120 },
  verticalAlign: VerticalAlign.CENTER,
  children: (Array.isArray(text) ? text : [text]).map((t) =>
    new Paragraph({
      spacing: { after: 0, line: 260 },
      children: [new TextRun({ text: String(t), font: opts.mono ? 'Consolas' : 'Calibri', size: opts.mono ? 18 : 20, color: TEXT, bold: opts.bold })],
    })
  ),
});

const makeTable = (headers, rows, columnWidths) => {
  const totalW = columnWidths.reduce((a, b) => a + b, 0);
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) => headerCell(h, columnWidths[i])),
  });
  const dataRows = rows.map((r, idx) =>
    new TableRow({
      children: r.map((cell, i) => dataCell(cell, columnWidths[i], { alt: idx % 2 === 1, mono: false })),
    })
  );
  return new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths,
    rows: [headerRow, ...dataRows],
  });
};

const spacer = () => new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: '' })] });

// ---- TITLE PAGE ----
const titlePage = [
  new Paragraph({ spacing: { before: 2400, after: 0 }, children: [new TextRun({ text: '' })] }),
  new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { after: 120 },
    children: [new TextRun({ text: 'HUMANOS', font: 'Calibri', size: 24, bold: true, color: TEAL, characterSpacing: 40 })],
  }),
  new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { after: 80 },
    children: [new TextRun({ text: 'ANS Diagnostic', font: 'Calibri', size: 56, bold: true, color: TEXT })],
  }),
  new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { after: 320 },
    children: [new TextRun({ text: 'System Architecture', font: 'Calibri', size: 48, bold: false, color: TEXT })],
  }),
  new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { after: 600 },
    children: [new TextRun({ text: 'Beta v1.0', font: 'Calibri', size: 28, color: MUTED, italics: true })],
  }),
  new Paragraph({ spacing: { after: 2400 }, children: [new TextRun({ text: '' })] }),

  new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: 'Date', font: 'Calibri', size: 18, bold: true, color: MUTED, characterSpacing: 20 })],
  }),
  new Paragraph({
    spacing: { after: 200 },
    children: [new TextRun({ text: 'April 21, 2026', font: 'Calibri', size: 24, color: TEXT })],
  }),
  new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: 'Prepared for', font: 'Calibri', size: 18, bold: true, color: MUTED, characterSpacing: 20 })],
  }),
  new Paragraph({
    spacing: { after: 200 },
    children: [new TextRun({ text: "Ben O'Leary, ThingkTangk", font: 'Calibri', size: 24, color: TEXT })],
  }),
  new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: 'Prepared by', font: 'Calibri', size: 18, bold: true, color: MUTED, characterSpacing: 20 })],
  }),
  new Paragraph({
    spacing: { after: 200 },
    children: [new TextRun({ text: 'Perplexity Computer', font: 'Calibri', size: 24, color: TEXT })],
  }),
];

// ---- TOC ----
const tocPage = [
  new Paragraph({
    pageBreakBefore: true,
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text: 'Table of Contents', font: 'Calibri', size: 36, bold: true, color: TEAL })],
    spacing: { before: 0, after: 240 },
  }),
  new TableOfContents('Table of Contents', {
    hyperlink: true,
    headingStyleRange: '1-2',
  }),
];

// ---- CONTENT SECTIONS ----
const content = [];

// 3. Executive Summary
content.push(h1Break('1. Executive Summary'));
content.push(body(
  "HumanOS ANS Diagnostic is a single-page web application that ingests proprietary binary .ans files — autonomic nervous system test recordings captured via the Ewing / Colombo P&S methodology — and returns a gamified, interactive diagnostic report. Users drag a binary file into the browser; a Vercel serverless function parses the file, runs a spectral-analysis pipeline (R-peak detection, FFT, LF/HF band integration) across four autonomic challenge phases, classifies each parameter against age-stratified normative ranges, computes a five-factor wellness score, and returns a full clinical report rendered as animated gauges, KPI cards, and five narrative slides. The system is stateless, requires no authentication, stores no data, and deploys as a static SPA plus two Node.js serverless functions on Vercel."
));

// 4. System Overview
content.push(h1Break('2. System Overview'));
content.push(h2('Purpose'));
content.push(body(
  "Translate a raw ANS test recording into an accessible, visually engaging diagnostic report that communicates autonomic nervous system health to both clinicians and patients. The product pairs clinically grounded Colombo P&S classifications with a gamified presentation layer (animated wellness gauge, sympathovagal wave, staged progress animation) to replace the dense, text-heavy legacy ANS reports used in practice today."
));
content.push(h2('Primary Users'));
content.push(bullet("Clinicians reviewing ANS test output for patients with suspected autonomic dysfunction, POTS, neuropathy, or orthostatic intolerance."));
content.push(bullet("Patients receiving a readable summary of their own test, with wellness gauge, metric cards, and therapy recommendations."));
content.push(bullet("ThingkTangk product and clinical stakeholders evaluating the beta."));
content.push(h2('Scope'));
content.push(body(
  "In scope: binary .ans parsing, spectral analysis of embedded ECG, Colombo P&S classification, wellness scoring, clinical report rendering, and deployment as a static SPA. Out of scope for Beta v1.0: authentication, persistence, multi-user accounts, historical trend tracking, EHR integration, HIPAA compliance, and administrative dashboards."
));

// 5. Architecture Layers
content.push(h1Break('3. Architecture Layers'));
content.push(body("The system is organized into seven logical layers. Only layers one through four are active in production; the remaining layers exist in the codebase but are scoped to local development or are scaffolded but unused."));

const layerRows = [
  ['1', 'Client (Browser)', 'React 18 SPA built with Vite. Tailwind + shadcn/ui styling. Hash-based routing via wouter. Runs entirely in the browser after initial asset load.'],
  ['2', 'Edge / CDN', "Vercel's global CDN serves the static bundle. vercel.json rewrites route /api/* to serverless functions and all other paths to /index.html for SPA fallback."],
  ['3', 'API (Serverless)', 'Two Node.js 20 functions deployed on Vercel: api/upload.ts (parse + report) and api/health.ts (health check). 256 MB memory, 30-second maximum duration.'],
  ['4', 'Algorithm', 'Fully inlined inside api/upload.ts: binary parser, R-peak detection, FFT spectral analysis, Colombo P&S classifier, wellness scoring model, therapy rule engine.'],
  ['5', 'Shared Schema', 'Zod schemas and inferred TypeScript types in shared/schema.ts. Used by the dev Express path; production serverless function has types inlined to avoid cross-directory NFT resolution issues.'],
  ['6', 'Dev Express Server', 'server/index.ts and server/routes.ts provide an Express 5 server with Vite middleware for local HMR development. Not packaged or deployed to Vercel.'],
  ['7', 'Data / Persistence', 'None in production. Dev code includes an in-memory MemStorage class that is not touched by the ANS pipeline. All processing is stateless and request-scoped.'],
];
content.push(makeTable(['#', 'Layer', 'Responsibility'], layerRows, [720, 2200, 7160]));

// 6. Component Breakdown
content.push(h1Break('4. Component Breakdown'));
content.push(h2('Frontend Components'));
const feRows = [
  ['dashboard.tsx', 'Page', 'Top-level state machine: upload → analyzing → report. Owns the React Query mutation that POSTs to /api/upload.'],
  ['UploadScreen.tsx', 'Screen', 'Drag-and-drop zone that accepts a .ans file and triggers the upload flow.'],
  ['AnalyzingScreen.tsx', 'Screen', '16-stage scripted progress animation with ECG waveform visual while the real upload runs in parallel.'],
  ['ReportDashboard.tsx', 'Layout', 'Main report layout — assembles sidebar, gauges, metric cards, wave, and slides.'],
  ['ReportSlides.tsx', 'Component', 'Five-slide narrative clinical report with navigation.'],
  ['WellnessGauge.tsx', 'Component', 'Animated circular gauge rendering the 0–100 wellness score.'],
  ['MetricCards.tsx', 'Component', 'KPI cards for HRV, stress index, sympathovagal balance, and related metrics.'],
  ['AutonomicWave.tsx', 'Component', 'Animated sympathovagal balance wave visualization.'],
  ['PatientSidebar.tsx', 'Component', 'Demographics sidebar (name, age, sex, physician, BMI, test notes).'],
  ['PerplexityAttribution.tsx', 'Component', 'Footer attribution block.'],
  ['ui/*', 'Primitives', 'shadcn/ui Radix-based primitives (button, card, dialog, toast, etc.).'],
  ['queryClient.ts', 'Lib', 'TanStack Query client setup and the shared apiRequest helper.'],
];
content.push(makeTable(['File', 'Kind', 'Responsibility'], feRows, [2400, 1200, 6480]));

content.push(h2('Backend Functions'));
const beRows = [
  ['POST', '/api/upload', 'api/upload.ts', 'Accepts multipart file upload, parses binary .ans, runs spectral analysis across four phases, classifies parameters, generates wellness score and full clinical report, returns JSON.'],
  ['GET', '/api/health', 'api/health.ts', 'Lightweight liveness probe returning { status: "ok", version: "1.0.0" }.'],
];
content.push(makeTable(['Method', 'Path', 'File', 'Responsibility'], beRows, [1100, 1800, 1900, 5280]));

// 7. Technology Stack
content.push(h1Break('5. Technology Stack'));
content.push(body("Versions reflect package.json at the time of writing. The stack is TypeScript end-to-end with Node 20 on the server and React 18 in the browser."));

content.push(h3('Core Runtime'));
content.push(makeTable(
  ['Category', 'Package', 'Version'],
  [
    ['Runtime', 'Node.js', '20 (Vercel default)'],
    ['Language', 'TypeScript', '5.6.3'],
    ['UI Library', 'React', '18.3.1'],
  ],
  [3000, 4080, 3000]
));

content.push(h3('Build Toolchain'));
content.push(makeTable(
  ['Package', 'Version', 'Role'],
  [
    ['Vite', '7.3.0', 'Frontend bundler and dev server'],
    ['@vitejs/plugin-react', '4.7', 'React Fast Refresh and JSX'],
    ['tsx', '4.20', 'TypeScript runner for the dev Express server'],
    ['esbuild', '0.25', 'Underlying transpiler used by Vite/tsx'],
  ],
  [3200, 1800, 5080]
));

content.push(h3('Frontend Libraries'));
content.push(makeTable(
  ['Category', 'Package', 'Version'],
  [
    ['Routing', 'wouter (useHashLocation)', '3.3.5'],
    ['Data fetching', '@tanstack/react-query', '5.60'],
    ['Styling', 'tailwindcss + tailwindcss-animate', '3.4.17'],
    ['Animation utilities', 'tw-animate-css', 'latest'],
    ['Component primitives', 'shadcn/ui over Radix UI', '25+ @radix-ui packages'],
    ['Forms', 'react-hook-form + @hookform/resolvers', '7.55'],
    ['Animation', 'framer-motion', '11.13'],
    ['Icons', 'lucide-react / react-icons', '0.453 / 5.4'],
    ['Charts', 'recharts', '2.15'],
    ['Validation', 'zod + drizzle-zod', '3.24 / 0.7'],
  ],
  [2800, 4200, 3080]
));

content.push(h3('Backend — Production (Vercel Serverless)'));
content.push(makeTable(
  ['Package', 'Version', 'Role'],
  [
    ['@vercel/node', '5.6', 'Types for Vercel Request / Response'],
    ['Node runtime', '20.x', 'Serverless function runtime'],
    ['Function limits', '256 MB / 30 s', 'Memory and max duration'],
  ],
  [3200, 2000, 4880]
));

content.push(h3('Backend — Dev Only'));
content.push(makeTable(
  ['Package', 'Version', 'Role'],
  [
    ['express', '5.0.1', 'HTTP framework for local dev'],
    ['multer', '2.1.1', 'Multipart upload parsing (50 MB cap)'],
    ['ws', '8.18', 'WebSocket server (scaffolded)'],
    ['drizzle-orm + pg', '0.39 / 8.16', 'ORM + Postgres driver (scaffolded, unused)'],
  ],
  [3000, 2200, 4880]
));

// 8. Request Flow
content.push(h1Break('6. Request Flow'));
content.push(body("The end-to-end path of a file upload in production, from the user drag-and-drop to the rendered report."));

content.push(h3('Step-by-Step'));
const stepRows = [
  ['1', 'User drops a .ans file into UploadScreen. dashboard.tsx transitions state machine to analyzing.'],
  ['2', 'AnalyzingScreen mounts and starts the 16-stage scripted progress animation (~4–5 s). In parallel, the React Query mutation POSTs the file as multipart/form-data to /api/upload.'],
  ['3', "Request hits Vercel's edge. vercel.json rewrites /api/(.*) to the serverless function bundle for api/upload.ts."],
  ['4', 'The serverless function cold-starts (if idle) on Node 20, 256 MB. parseMultipart() extracts the raw binary body from the first file part.'],
  ['5', 'parseANSFile(buffer) reads the LP-string header (last name, first name, DOB bytes, gender, physician), scans for the sampling interval double, extracts the uint16 ECG sample array, and regex-matches clinical ratios embedded in inline ASCII.'],
  ['6', 'segmentPhases() partitions the ECG into four phases: baseline, deep breathing, Valsalva, table stand.'],
  ['7', 'performSpectralAnalysis() runs on each phase: R-peak detection → RR intervals → mean HR and SDNN → DFT on detrended series → LF and HF power integration → RFa, LFa, SB.'],
  ['8', 'classifyParameter() maps each metric to Low / Borderline Low / Normal / Borderline High / High using age-stratified normative ranges.'],
  ['9', 'Dysfunction pattern detection fires boolean flags (sympathetic excess, POTS, advanced autonomic dysfunction, etc.).'],
  ['10', 'The wellness score is computed by the five-factor weighted model, age-adjusted, and penalized for ectopic beats.'],
  ['11', 'Therapy recommendations and follow-up interval are derived by rule-based logic.'],
  ['12', 'Function returns JSON: { success, patientData, report }. Response is serialized over HTTPS back to the browser.'],
  ['13', 'Once both the progress animation and the network response have resolved, dashboard.tsx transitions state to report. ReportDashboard renders the gauge, cards, wave, sidebar, and five-slide report.'],
];
content.push(makeTable(['#', 'Action'], stepRows, [720, 9360]));

content.push(h3('Flow Diagram'));
const flowDiagram = `+-----------------+     HTTPS       +------------------+
|  User's browser | --------------> |  Vercel Edge/CDN |
|  (React SPA)    | <-------------- |  (humanos-ans-   |
+-----------------+                 |   diagnostic.    |
        |                           |   vercel.app)    |
        | user drops .ans file      +------------------+
        |                                    |
        | POST /api/upload (multipart)       | /api/* rewrite (vercel.json)
        | ---------------------------------> |
        |                                    v
        |                           +------------------+
        |                           |  Serverless Fn   |
        |                           |  api/upload.ts   |
        |                           |  (Node 20, 256MB)|
        |                           |                  |
        |                           |  1. parseMultipart()
        |                           |  2. parseANSFile(buffer)
        |                           |  3. performSpectralAnalysis() x4 phases
        |                           |  4. classifyParameter() each metric
        |                           |  5. generateANSReport()
        |                           |  6. Wellness score (5-factor weighted)
        |                           +------------------+
        | <---------- JSON ------------------ |
        |  { success, patientData, report }   |
        v
+-----------------+
| AnalyzingScreen | animates progress 0->100%, staged labels
|        |        |
| ReportDashboard | renders 5-slide clinical report + gauges
+-----------------+`;
content.push(...codeBlock(flowDiagram));

// 9. API Contract
content.push(h1Break('7. API Contract'));

content.push(h2('POST /api/upload'));
content.push(makeTable(
  ['Field', 'Value'],
  [
    ['Method', 'POST'],
    ['Path', '/api/upload'],
    ['Content-Type', 'multipart/form-data'],
    ['File field', 'ansFile (parser grabs the first file part regardless of name)'],
    ['Max file size (prod)', '~4.5 MB (Vercel request body limit)'],
    ['Max file size (dev)', '50 MB (multer config)'],
    ['Auth', 'None'],
    ['CORS', 'Access-Control-Allow-Origin: *'],
    ['Function runtime', 'Node 20, 256 MB, 30 s maximum'],
  ],
  [3200, 6880]
));

content.push(h3('Success Response (200)'));
content.push(...codeBlock(`{
  "success": true,
  "patientData": ANSPatientData,   // parsed demographics + ECG samples
  "report":      ANSReport         // full clinical report
}`));

content.push(h3('Error Response (400 / 500)'));
content.push(...codeBlock(`{
  "success": false,
  "error":   string
}`));

content.push(h2('GET /api/health'));
content.push(makeTable(
  ['Field', 'Value'],
  [
    ['Method', 'GET'],
    ['Path', '/api/health'],
    ['Auth', 'None'],
    ['Function runtime', 'Node 20, 256 MB'],
  ],
  [3200, 6880]
));
content.push(h3('Response (200)'));
content.push(...codeBlock(`{
  "status":  "ok",
  "version": "1.0.0"
}`));

// 10. Data Model
content.push(h1Break('8. Data Model'));
content.push(body("Two top-level TypeScript shapes are returned from the /api/upload endpoint: ANSPatientData, which carries the parsed demographics and the raw signal, and ANSReport, which carries every clinical output computed by the algorithm."));

content.push(h3('ANSPatientData'));
content.push(...codeBlock(`interface ANSPatientData {
  firstName: string;
  lastName:  string;
  age:       number;          // extracted from ANS byte scan
  gender:    "Male" | "Female" | string;
  physician: string;
  heightIn:  number;          // total inches
  bmi:       number | null;
  samplingRateHz: number;     // typically 250
  recordingSeconds: number;   // samples / rate
  ecgSamples: number[];       // uint16 BE decoded
  ratios: {
    eiRatio:      number;     // E/I
    valsalva:     number;
    ratio3015:    number;     // 30:15
    ectopicBeats: number;
  };
  notes: string;
}`));

content.push(h3('ANSReport'));
content.push(...codeBlock(`interface ANSReport {
  phases: {
    baseline:     PhaseMetrics;
    deepBreath:   PhaseMetrics;
    valsalva:     PhaseMetrics;
    stand:        PhaseMetrics;
  };
  classifications: Record<string, Classification>;
  dysfunction: {
    parasympatheticExcess:        boolean;
    parasympatheticWithdrawal:    boolean;
    sympatheticExcess:            boolean;
    sympatheticWithdrawal:        boolean;
    advancedAutonomicDysfunction: boolean;
    pots:                         boolean;  // HR delta >= 30 bpm on stand
    orthostaticDysfunction:       boolean;
    syncopeRisk:                  boolean;
  };
  wellness: {
    score: number;            // 0-100
    factors: {
      baselineTone:       number;
      sympathovagal:      number;
      reflexIntegrity:    number;
      orthostaticResp:    number;
      hrvReserve:         number;
    };
  };
  therapies: string[];        // Hydration, Low-and-Slow Exercise, ALA, Nortriptyline
  followUpMonths: 3 | 6;
  summary: string;
}

interface PhaseMetrics {
  rfa:    number;   // parasympathetic (HF power)
  lfa:    number;   // sympathetic    (LF power)
  sb:     number;   // LFa / RFa
  meanHR: number;
  hrv:    number;   // SDNN, ms
}

type Classification =
  | "Low" | "Borderline Low" | "Normal" | "Borderline High" | "High";`));

// 11. ANS File Format
content.push(h1Break('9. ANS Binary File Format'));
content.push(body(".ans files are big-endian binary recordings emitted by the Colombo P&S test hardware. The parser reads a header of length-prefixed ASCII strings, scans for a known double-precision constant to locate the sample interval, then reads the uint16 ECG stream. Clinical ratios are embedded later in the file as inline ASCII and extracted by regex."));

content.push(h3('Layout'));
content.push(makeTable(
  ['Offset', 'Type', 'Field'],
  [
    ['0', 'LP-string (uint32 length + ASCII)', 'Last name'],
    ['→', 'LP-string', 'First name'],
    ['→', '8 bytes', 'Date of birth (raw; unreliable — age extracted from later byte)'],
    ['→', 'LP-string', 'Gender'],
    ['→', 'LP-string', 'Physician'],
    ['→', 'scan window', 'Age (single byte flanked by zeros)'],
    ['~336', 'double BE', 'Sampling interval (0.004 s = 250 Hz)'],
    ['+8', 'uint32 BE', 'Data point count (~232,680 samples for a 15.5-min record)'],
    ['+12', 'uint16 BE[]', 'ECG samples'],
    ['(inline ASCII)', 'regex-extracted', 'E/I ratio, Valsalva ratio, 30:15 ratio, ectopic beats, height, notes'],
  ],
  [1800, 3200, 5080]
));

content.push(h3('Reference Sample'));
content.push(body("The test file bundled with the repository — Pare-Alex-Thu-Jul-11-2024.ans — decodes as: Pare, Alex; Male; age 48; 6 ft 2 in (74 in); BMI 25.68; referring physician Dr. Colombo; E/I 1.22; Valsalva 1.49; 30:15 1.33; 232,680 samples at 250 Hz; 15.5-minute recording."));

// 12. Algorithm Pipeline
content.push(h1Break('10. Algorithm Pipeline'));
content.push(body("All eight stages run inside the api/upload.ts serverless function. The pipeline is deliberately self-contained (no cross-directory imports) to keep Vercel's Node File Tracing bundler happy."));

const algRows = [
  ['1', 'parseANSFile(buffer)', 'Read LP-string header, scan for sampling-interval double, extract uint16 ECG array, regex-extract clinical ratios and notes.'],
  ['2', 'segmentPhases(ecg, duration)', 'Partition ECG into four phases by time fraction: baseline 0–33%, deep breathing 33–40%, Valsalva 40–45%, table stand 45–100%.'],
  ['3', 'performSpectralAnalysis(phase, rate)', 'R-peak detection via 75th-percentile adaptive threshold + local maxima + 200 ms refractory. Compute RR intervals, mean HR, SDNN. Run a DFT on the detrended RR series and integrate power in LF (0.04–0.15 Hz) and HF (0.15–0.4 Hz) bands. Emit RFa = HF power (parasympathetic), LFa = LF power (sympathetic), SB = LFa / RFa, meanHR, hrv.'],
  ['4', 'classifyParameter(value, ranges)', 'Age-stratified (young / middle / senior) normative ranges produce a five-level label: Low, Borderline Low, Normal, Borderline High, High.'],
  ['5', 'Dysfunction pattern recognition', 'Boolean flags: parasympatheticExcess, parasympatheticWithdrawal, sympatheticExcess, sympatheticWithdrawal, advancedAutonomicDysfunction, POTS (HR Δ ≥ 30 bpm on stand), orthostaticDysfunction, syncopeRisk.'],
  ['6', 'Wellness score', 'Five-factor weighted continuous model with age multiplier and ectopic-beat penalty. See Section 11 for the full breakdown.'],
  ['7', 'Therapy recommendations', 'Rule-based, gated by dysfunction flags: Hydration, Low-and-Slow Exercise, Alpha-Lipoic Acid, Nortriptyline.'],
  ['8', 'Follow-up interval', 'Three or six months based on overall severity of findings.'],
];
content.push(makeTable(['#', 'Stage', 'Description'], algRows, [600, 2600, 6880]));

// 13. Wellness Score Model
content.push(h1Break('11. Wellness Score Model'));
content.push(body("The wellness score is a single 0–100 number rendered in the central gauge of the report. It is a weighted sum of five sub-scores, each on a 0–100 scale, followed by an age multiplier and an ectopic-beat penalty, floored at 15 and ceilinged at 100."));

content.push(h3('Five-Factor Breakdown'));
const wellnessRows = [
  ['Baseline Autonomic Tone', '25%', 'bandScore() applied to RFa, LFa, and mean HR at rest.'],
  ['Sympathovagal Balance', '15%', 'Baseline SB + stand SB + expected SB rise on stand.'],
  ['Reflex Integrity', '25%', 'Threshold scoring of E/I, Valsalva, and 30:15 ratios plus the deep-breathing RFa gain.'],
  ['Orthostatic Response', '20%', 'HR Δ on stand + stand LFa/RFa band scores + LFa gain from rest to stand.'],
  ['HRV Reserve', '15%', 'Average SDNN across all four phases vs. age-expected (young 55, middle 45, senior 35 ms) plus per-phase SDNN spread.'],
];
content.push(makeTable(['Factor', 'Weight', 'Definition'], wellnessRows, [3000, 1200, 5880]));

content.push(h3('Post-Processing'));
content.push(bullet('Weighted sum of the five sub-scores.'));
content.push(bullet('Age multiplier applied: young × 1.00, middle × 1.03, senior × 1.07.'));
content.push(bullet('Ectopic-beat penalty subtracted proportional to ectopicBeats.'));
content.push(bullet('Result clamped to the range [15, 100].'));

content.push(h3('Normative Reference Ranges (HRV Reserve)'));
content.push(makeTable(
  ['Age Band', 'Expected SDNN (ms)', 'Age Multiplier'],
  [
    ['Young (< 40)', '55', '1.00'],
    ['Middle (40–59)', '45', '1.03'],
    ['Senior (60+)', '35', '1.07'],
  ],
  [3400, 3400, 3280]
));

// 14. Frontend State Machine
content.push(h1Break('12. Frontend State Machine'));
content.push(body("dashboard.tsx holds the top-level UI state. Only three states exist; transitions are driven by the file drop, the API response, and user-initiated reset."));

const stateDiagram = `+---------+   file dropped    +--------------+   report arrives   +--------+
| upload  | ----------------> |  analyzing   | -----------------> | report |
+---------+                   +--------------+                    +--------+
    ^                                |                                |
    |                                | error                          | reset
    +--------------------------------+--------------------------------+`;
content.push(...codeBlock(stateDiagram));

content.push(spacer());
content.push(h3('State Descriptions'));
content.push(makeTable(
  ['State', 'Behavior'],
  [
    ['upload', 'Drag-and-drop zone. Accepts a .ans file; on drop, transitions to analyzing and fires the React Query mutation.'],
    ['analyzing', '16-stage scripted progress animation (~4–5 s) with staged labels from "Reading .ans binary..." to "Assembling diagnostic report..." and an ECG waveform overlay. Real POST runs in parallel. When both complete, transitions to report.'],
    ['report', 'Renders ReportDashboard: WellnessGauge, MetricCards, AutonomicWave, PatientSidebar, and the five-slide ReportSlides. Reset returns to upload.'],
  ],
  [2000, 8080]
));

// 15. Build & Deployment
content.push(h1Break('13. Build and Deployment'));

content.push(h3('Local Development'));
content.push(bullet("npm run dev starts tsx against server/index.ts, spinning up Express 5 on port 5000 with Vite middleware for HMR. Frontend and backend share one port."));
content.push(bullet("Local dev uses multer to accept uploads up to 50 MB — this is strictly a dev affordance; production uses the native Vercel body limit."));

content.push(h3('Vercel Build'));
content.push(bullet("npm run build:vercel runs vite build --outDir ../build_output. Frontend static assets are emitted to /build_output at the repo root."));
content.push(bullet("api/*.ts files are auto-detected by Vercel as serverless functions and bundled individually using Node File Tracing (nft)."));

content.push(h3('Routing (vercel.json)'));
content.push(...codeBlock(`{
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" },
    { "source": "/(.*)",     "destination": "/index.html" }
  ]
}`));

content.push(h3('Deploy Targets'));
content.push(makeTable(
  ['Item', 'Value'],
  [
    ['Live URL', 'https://humanos-ans-diagnostic.vercel.app'],
    ['GitHub', 'https://github.com/BenThingkTangk/ANSReportGeneratorBeta'],
    ['Vercel Project ID', 'prj_dQgeUYPy7AxEiAUlHf61YTN6TW7k'],
    ['Function runtime', 'Node 20.x'],
    ['Memory / Duration', '256 MB / 30 s'],
  ],
  [3000, 7080]
));

// 16. Security & Compliance
content.push(h1Break('14. Security and Compliance'));
content.push(bullet("No authentication and no user accounts. Anyone with the URL can upload a file and receive a report."));
content.push(bullet("All processing is stateless and request-scoped. There is no database, no session store, and no disk persistence."));
content.push(bullet("Serverless function has a 30-second timeout and 256 MB of memory."));
content.push(bullet("File size is capped by Vercel's request body limit — approximately 4.5 MB in production."));
content.push(bullet("CORS is set to * on /api/upload to support embeds and cross-origin testing."));
content.push(bullet("TLS in transit is provided by Vercel by default; no TLS termination is managed by the app itself."));
content.push(bullet("HIPAA: Not HIPAA compliant. The app is a beta/demo. No PHI is stored, but there is no Business Associate Agreement configured with Vercel, so files should not contain identifiable patient data in production use."));

// 17. Design Decisions
content.push(h1Break('15. Known Design Decisions and Trade-offs'));
content.push(makeTable(
  ['Decision', 'Rationale / Trade-off'],
  [
    ['Self-contained api/upload.ts (~830 lines)', "Parser, algorithm, and types are inlined into the single serverless file to sidestep Vercel's Node File Tracing failing across api/ → server/ → shared/ directory imports. This is the fix that made the deployed upload endpoint actually work. Trade-off: duplication between the dev Express path and the prod serverless path."],
    ['Hash routing (useHashLocation)', 'Required because the app is served as a static SPA and may be embedded in iframes where history-based routing is blocked. Trade-off: URLs carry a # fragment.'],
    ['Dark medical theme', 'Tailwind darkMode: "class" with a custom teal/cyan accent in the #20808D family on near-black surfaces. Chosen for clinical-product aesthetic and to make animated gauges pop.'],
    ['Cosmetic progress animation', "The 16-stage progress bar in AnalyzingScreen is scripted (not tied to actual algorithm progress). It is designed for 'super cool realtime genUI' feel per user request. Trade-off: if the algorithm runs long, the animation finishes first and the UI simply waits on the network."],
    ['No auth / no persistence', 'Keeps the beta footprint tiny and the deploy trivially stateless. Trade-off: not suitable for production clinical use without a substantial security layer.'],
    ['drizzle-orm scaffolded but unused', 'Left in place from the starter template in case a future version adds persistence. No schema is applied and no database is provisioned.'],
  ],
  [3200, 6880]
));

// 18. File Tree Appendix
content.push(h1Break('16. Appendix — File Tree'));
const fileTree = `humanos-ans/
|-- api/                        # Vercel serverless functions (production API)
|   |-- upload.ts               # POST /api/upload — parse + report (SELF-CONTAINED)
|   \`-- health.ts               # GET  /api/health — health check
|-- client/                     # React frontend
|   |-- index.html              # HTML entry
|   \`-- src/
|       |-- main.tsx            # React root, hash-routing bootstrap
|       |-- App.tsx             # Router, QueryClientProvider, Toaster
|       |-- index.css           # Tailwind base, dark medical theme tokens
|       |-- pages/
|       |   |-- dashboard.tsx   # State machine: upload -> analyzing -> report
|       |   \`-- not-found.tsx
|       |-- components/
|       |   |-- UploadScreen.tsx
|       |   |-- AnalyzingScreen.tsx
|       |   |-- ReportDashboard.tsx
|       |   |-- ReportSlides.tsx
|       |   |-- WellnessGauge.tsx
|       |   |-- MetricCards.tsx
|       |   |-- AutonomicWave.tsx
|       |   |-- PatientSidebar.tsx
|       |   |-- PerplexityAttribution.tsx
|       |   \`-- ui/             # shadcn/ui primitives (Radix wrappers)
|       |-- hooks/              # use-mobile, use-toast
|       \`-- lib/
|           |-- queryClient.ts  # TanStack Query client + apiRequest helper
|           \`-- utils.ts        # cn() class merger
|-- server/                     # Dev-only Express server (NOT used on Vercel)
|   |-- index.ts                # Express entry
|   |-- routes.ts               # /api/upload + /api/health (Express version)
|   |-- ansParser.ts            # Dev version of parser
|   |-- ansAlgorithm.ts         # Dev version of algorithm
|   |-- storage.ts              # IStorage + MemStorage (unused for ANS)
|   |-- vite.ts                 # Vite middleware for dev
|   \`-- static.ts               # Static serving for local prod builds
|-- shared/
|   \`-- schema.ts               # Zod schemas + inferred TypeScript types
|-- script/
|   \`-- build.ts                # Local build script
|-- vercel.json                 # Vercel routing, function config
|-- vite.config.ts              # Vite config (root = client/)
|-- tailwind.config.ts          # Tailwind v3 config, darkMode: "class"
|-- tsconfig.json               # Strict TS, moduleResolution: bundler
|-- drizzle.config.ts           # Unused (scaffolded from template)
\`-- package.json`;
content.push(...codeBlock(fileTree));

// 18. References
content.push(h1Break('17. References'));
content.push(bulletRuns([
  new TextRun({ text: 'Live application: ', font: 'Calibri', size: 22, color: TEXT }),
  new ExternalHyperlink({
    link: 'https://humanos-ans-diagnostic.vercel.app',
    children: [new TextRun({ text: 'humanos-ans-diagnostic.vercel.app', font: 'Calibri', size: 22, color: TEAL, underline: {} })],
  }),
]));
content.push(bulletRuns([
  new TextRun({ text: 'Source repository: ', font: 'Calibri', size: 22, color: TEXT }),
  new ExternalHyperlink({
    link: 'https://github.com/BenThingkTangk/ANSReportGeneratorBeta',
    children: [new TextRun({ text: 'github.com/BenThingkTangk/ANSReportGeneratorBeta', font: 'Calibri', size: 22, color: TEAL, underline: {} })],
  }),
]));
content.push(bullet("Vercel project ID: prj_dQgeUYPy7AxEiAUlHf61YTN6TW7k"));
content.push(bullet("Architecture brief: humanos-ans/ARCHITECTURE_BRIEF.md (source of truth for this document)."));

// 19. Revision history (closing)
content.push(h1Break('18. Revision History'));
content.push(makeTable(
  ['Version', 'Date', 'Author', 'Notes'],
  [
    ['Beta v1.0', '2026-04-21', 'Perplexity Computer', 'Initial system architecture document for HumanOS ANS Diagnostic beta.'],
  ],
  [2000, 2000, 3000, 3080]
));

// ---- DOCUMENT ----
const report = new Document({
  creator: 'Perplexity Computer',
  title: 'HumanOS ANS Diagnostic — System Architecture',
  description: 'System Architecture Document for HumanOS ANS Diagnostic Beta v1.0',
  styles: {
    default: {
      document: { run: { font: 'Calibri', size: 22, color: TEXT } },
    },
    paragraphStyles: [
      {
        id: 'Heading1',
        name: 'Heading 1',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { size: 36, bold: true, font: 'Calibri', color: TEAL },
        paragraph: { spacing: { before: 360, after: 160 }, outlineLevel: 0 },
      },
      {
        id: 'Heading2',
        name: 'Heading 2',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { size: 28, bold: true, font: 'Calibri', color: TEAL },
        paragraph: { spacing: { before: 260, after: 120 }, outlineLevel: 1 },
      },
      {
        id: 'Heading3',
        name: 'Heading 3',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { size: 24, bold: true, font: 'Calibri', color: TEXT },
        paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 2 },
      },
      {
        id: 'Hyperlink',
        name: 'Hyperlink',
        basedOn: 'Normal',
        run: { color: TEAL, underline: {} },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: '\u2022',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 480, hanging: 240 } } },
        }],
      },
    ],
  },
  sections: [
    // Title section — no page number
    {
      properties: {
        page: {
          size: { width: PAGE_W, height: 15840 },
          margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
        },
      },
      children: titlePage,
    },
    // Main body — TOC + content, with page numbers
    {
      properties: {
        page: {
          size: { width: PAGE_W, height: 15840 },
          margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: 'HumanOS ANS Diagnostic — System Architecture', font: 'Calibri', size: 16, color: MUTED })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: 'Page ', font: 'Calibri', size: 18, color: MUTED }),
              new TextRun({ children: [PageNumber.CURRENT], font: 'Calibri', size: 18, color: MUTED }),
              new TextRun({ text: ' of ', font: 'Calibri', size: 18, color: MUTED }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], font: 'Calibri', size: 18, color: MUTED }),
            ],
          })],
        }),
      },
      children: [...tocPage, ...content],
    },
  ],
});

Packer.toBuffer(report).then((buf) => {
  const outPath = '/home/user/workspace/humanos-ans/HumanOS_ANS_System_Architecture.docx';
  fs.writeFileSync(outPath, buf);
  console.log('Wrote', outPath, buf.length, 'bytes');
}).catch((e) => {
  console.error('ERROR', e);
  process.exit(1);
});
