import assert from "node:assert/strict";
import test from "node:test";
import { estimateTruePeak } from "../public/js/peak-limiter.js";
import { encodeWav } from "../public/js/wav.js";

test("the export peak estimator detects a peak above the PCM samples", () => {
 const channel=Float32Array.from({length:128},(_,i)=>i<16||i>=112?0:Math.sin(i*Math.PI/2+Math.PI/4));
 const samplePeak=channel.reduce((peak,sample)=>Math.max(peak,Math.abs(sample)),0);
 assert.ok(samplePeak<.71);
 assert.ok(estimateTruePeak([channel],channel.length,samplePeak,.891)>1);
 const quiet=channel.map(sample=>sample*.01);
 assert.equal(estimateTruePeak([quiet],quiet.length,samplePeak*.01,.891),samplePeak*.01);
});

test("the studio encoder writes interleaved stereo PCM at 96 kHz and 24 bits", async () => {
 const channels=[Float32Array.of(-1,0,.5),Float32Array.of(1,0,-.5)];
 const audio={length:3,sampleRate:96000,numberOfChannels:2,getChannelData:i=>channels[i]};
 const wave=Buffer.from(await encodeWav(audio,"studio.wav",24,{dither:true}).arrayBuffer());
 assert.equal(wave.toString("ascii",0,4),"RIFF");
 assert.equal(wave.readUInt16LE(20),1);
 assert.equal(wave.readUInt16LE(22),2);
 assert.equal(wave.readUInt32LE(24),96000);
 assert.equal(wave.readUInt16LE(34),24);
 assert.equal(wave.readUInt32LE(40),18);
 assert.ok(Math.abs(wave.readIntLE(44,3)+8388608)<=1);
 assert.ok(Math.abs(wave.readIntLE(47,3)-8388607)<=1);
 assert.ok(Math.abs(wave.readIntLE(56,3)-4194304)<=1);
 assert.ok(Math.abs(wave.readIntLE(59,3)+4194304)<=1);
});
