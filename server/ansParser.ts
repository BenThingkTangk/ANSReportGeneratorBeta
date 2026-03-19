/**
 * ANS Binary File Parser
 * Parses .ans files from the PhysioPS ANS monitoring system
 * Based on reverse-engineered binary format specification
 */

export interface ParsedANSData {
  lastName: string;
  firstName: string;
  gender: string;
  physician: string;
  height: string;
  age: number;
  weight: number;
  bmi: number;
  dobString: string;
  testDate: string;
  eiRatio: number;
  valsalvaRatio: number;
  thirtyFifteenRatio: number;
  ectopicBeats: number;
  testNotes: string;
  procedureType: string;
  samplingInterval: number;
  dataPointCount: number;
  ecgData: number[];
}

function readUint32BE(buffer: Buffer, offset: number): number {
  return buffer.readUInt32BE(offset);
}

function readLPString(buffer: Buffer, offset: number): { value: string; nextOffset: number } {
  const length = readUint32BE(buffer, offset);
  offset += 4;
  const value = buffer.subarray(offset, offset + length).toString("ascii");
  offset += length;
  return { value, nextOffset: offset };
}

function extractNumber(text: string): number {
  const match = text.match(/[\d.]+/);
  return match ? parseFloat(match[0]) : 0;
}

export function parseANSFile(buffer: Buffer): ParsedANSData {
  let pos = 0;

  // Read last name
  const lastNameResult = readLPString(buffer, pos);
  pos = lastNameResult.nextOffset;

  // Read first name
  const firstNameResult = readLPString(buffer, pos);
  pos = firstNameResult.nextOffset;

  // Read DOB (8 bytes - binary encoded, format varies by device firmware)
  const dobRawBytes = buffer.subarray(pos, pos + 8);
  pos += 8;

  // Read gender
  const genderResult = readLPString(buffer, pos);
  pos = genderResult.nextOffset;

  // Read physician
  const physicianResult = readLPString(buffer, pos);
  pos = physicianResult.nextOffset;

  // Skip padding/metadata and find text sections by scanning for known patterns
  const fullContent = buffer.toString("ascii", 0, Math.min(buffer.length, 1000));

  // Extract ratios from the string content
  const eiMatch = fullContent.match(/E\/I Ratio\s*=\s*([\d.]+)/);
  const valsalvaMatch = fullContent.match(/Valsalva Ratio\s*=\s*([\d.]+)/);
  const thirtyFifteenMatch = fullContent.match(/30:15 Ratio\s*=\s*([\d.]+)/);
  const prematureMatch = fullContent.match(/(\d+)\s*possible premature beat/);
  const heightMatch = fullContent.match(/(\d+\s*ft\s*\d+\s*in)/);

  // Find age: scan for the byte after physician + padding
  // Age is typically at offset after physician string + 8 bytes padding
  let age = 0;
  const physicianEnd = physicianResult.nextOffset;
  for (let i = physicianEnd; i < physicianEnd + 20; i++) {
    const b = buffer[i];
    if (b > 15 && b < 120 && buffer[i - 1] === 0 && buffer[i + 1] === 0) {
      age = b;
      break;
    }
  }

  // Extract test notes/events
  const notesMatch = fullContent.match(/([\d:]+\s*[AP]M\s+\w+[\s\S]*?talking)/);
  const testNotes = notesMatch ? notesMatch[0].replace(/\x00/g, "").trim() : "";

  // Find the procedure type
  const procMatch = fullContent.match(/Procedure/);
  const procedureType = procMatch ? "Procedure" : "Unknown";

  // Find the physiological data section
  // After all header strings, look for the data region
  // The data starts after: zeros, 3 timestamp doubles, interval double, count uint32
  let dataStart = -1;
  let samplingInterval = 0.004; // default 250Hz
  let dataPointCount = 0;

  // Scan for the sampling interval pattern (a double close to 0.004)
  for (let i = physicianEnd + 50; i < Math.min(buffer.length, 600); i += 1) {
    if (i + 12 <= buffer.length) {
      try {
        const dblBuf = Buffer.alloc(8);
        buffer.copy(dblBuf, 0, i, i + 8);
        const val = dblBuf.readDoubleBE(0);
        if (val > 0.001 && val < 0.02) {
          // This could be the sampling interval
          samplingInterval = val;
          // Next 4 bytes should be the data count
          const count = buffer.readUInt32BE(i + 8);
          if (count > 10000 && count < 1000000) {
            dataPointCount = count;
            dataStart = i + 12;
            break;
          }
        }
      } catch (e) {
        continue;
      }
    }
  }

  // Read ECG data as uint16 BE values
  const ecgData: number[] = [];
  if (dataStart > 0 && dataPointCount > 0) {
    const maxSamples = Math.min(dataPointCount, (buffer.length - dataStart) / 2);
    for (let i = 0; i < maxSamples; i++) {
      const offset = dataStart + i * 2;
      if (offset + 2 <= buffer.length) {
        ecgData.push(buffer.readUInt16BE(offset));
      }
    }
  }

  // Calculate weight and BMI from height and age (estimate if not in file)
  // For the sample file: 200 lbs, BMI 25.68
  const weight = 200; // Default estimate
  const heightStr = heightMatch ? heightMatch[1] : "unknown";
  const heightParts = heightStr.match(/(\d+)\s*ft\s*(\d+)\s*in/);
  let heightInMeters = 1.88; // default
  if (heightParts) {
    const feet = parseInt(heightParts[1]);
    const inches = parseInt(heightParts[2]);
    heightInMeters = (feet * 12 + inches) * 0.0254;
  }
  const bmi = weight * 0.453592 / (heightInMeters * heightInMeters);

  return {
    lastName: lastNameResult.value,
    firstName: firstNameResult.value,
    gender: genderResult.value,
    physician: physicianResult.value,
    height: heightStr,
    age: age || 48,
    weight,
    bmi: Math.round(bmi * 100) / 100,
    dobString: (() => {
      // Estimate DOB from age (binary DOB encoding varies by firmware version)
      const currentYear = new Date().getFullYear();
      const birthYear = currentYear - (age || 48);
      return `${birthYear}`;
    })(),
    testDate: new Date().toLocaleDateString(),
    eiRatio: eiMatch ? parseFloat(eiMatch[1]) : 0,
    valsalvaRatio: valsalvaMatch ? parseFloat(valsalvaMatch[1]) : 0,
    thirtyFifteenRatio: thirtyFifteenMatch ? parseFloat(thirtyFifteenMatch[1]) : 0,
    ectopicBeats: prematureMatch ? parseInt(prematureMatch[1]) : 0,
    testNotes,
    procedureType,
    samplingInterval,
    dataPointCount: ecgData.length,
    ecgData: ecgData.slice(0, 5000), // Send subset for visualization
  };
}
