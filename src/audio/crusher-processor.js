// Krümel: fewer samples and fewer steps, like an old sampler. `amount` (0..1)
// holds each sample for up to eight and cuts the steps from 4096 down to 32;
// at 0 the sound passes untouched.
class Crusher extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: "amount", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" }];
  }

  constructor() {
    super();
    this.phase = 0;
    this.held = [];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    const amount = parameters.amount[0];
    if (!input || input.length === 0) {
      for (const channel of output) channel.fill(0);
      return true;
    }
    if (amount < 0.001) {
      output.forEach((channel, index) => channel.set(input[index] ?? input[0]));
      return true;
    }
    const hold = 1 + 7 * amount;
    const steps = 2 ** (12 - 7 * amount);
    const wet = 0.35 + 0.65 * amount;
    const length = output[0].length;
    for (let frame = 0; frame < length; frame += 1) {
      this.phase += 1;
      const take = this.phase >= hold;
      if (take) this.phase -= hold;
      output.forEach((channel, index) => {
        const source = (input[index] ?? input[0])[frame];
        if (take || this.held[index] === undefined) this.held[index] = Math.round(source * steps) / steps;
        channel[frame] = source * (1 - wet) + this.held[index] * wet;
      });
    }
    return true;
  }
}

registerProcessor("kruemel", Crusher);
