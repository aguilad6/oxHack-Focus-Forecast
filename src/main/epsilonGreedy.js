// Epsilon-greedy bandit: picks which interaction (advice) to give, and learns which ones work.
// Most of the time it picks the interaction with the best average reward so far (exploit);
// with probability epsilon it picks one at random instead (explore), so it keeps trying the others.
//
// Saving uses the Memento pattern: EpsilonGreedy hands out a snapshot of its state (a memento),
// and EpsilonGreedySaver writes that snapshot to a file without needing to know how the bandit works.
// The factories build objects back from files.

const fs = require('fs');
const path = require('path');

// One thing we can recommend, e.g. new Interaction('take a break').
class Interaction {
  constructor(name) {
    this.name = name;
  }
}

// Snapshot of an EpsilonGreedy's state: plain data, safe to turn into JSON.
class EpsilonGreedyMemento {
  constructor(state) {
    this.state = state;
  }
}

class EpsilonGreedy {
  // interactions: list of Interaction. epsilon: chance (0..1) of picking at random.
  constructor(interactions, epsilon) {
    this.interactions = interactions;
    this.epsilon = epsilon;
    // One list per interaction: every time it was applied and the reward it got,
    // e.g. history.get('take a break') = [{ t: 1792870775673, reward: 1 }, ...]
    this.history = new Map(interactions.map((i) => [i.name, []]));
  }

  // Remember that an interaction was applied and how well it worked.
  record(interaction, reward, t = Date.now()) {
    const list = this.history.get(interaction.name);
    if (!list) throw new Error(`Unknown interaction: ${interaction.name}`);
    list.push({ t, reward });
  }

  // Average reward of an interaction so far. Never tried = Infinity, so each one gets tried once.
  averageReward(interaction) {
    const list = this.history.get(interaction.name);
    if (!list.length) return Infinity;
    return list.reduce((sum, entry) => sum + entry.reward, 0) / list.length;
  }

  // Pick the interaction to recommend next.
  choose() {
    if (Math.random() < this.epsilon) {
      return this.interactions[Math.floor(Math.random() * this.interactions.length)];
    }
    // Best average reward; ties are broken at random so no interaction is favoured by its position.
    const best = Math.max(...this.interactions.map((i) => this.averageReward(i)));
    const tied = this.interactions.filter((i) => this.averageReward(i) === best);
    return tied[Math.floor(Math.random() * tied.length)];
  }

  createMemento() {
    return new EpsilonGreedyMemento({
      epsilon: this.epsilon,
      interactions: this.interactions.map((i) => i.name),
      history: Object.fromEntries(this.history),
    });
  }

  restore(memento) {
    this.epsilon = memento.state.epsilon;
    for (const [name, list] of Object.entries(memento.state.history)) {
      if (this.history.has(name)) this.history.set(name, list.map((entry) => ({ ...entry })));
    }
  }
}

// Writes an EpsilonGreedy to a JSON file, e.g. new EpsilonGreedySaver('data/bandit.json').save(bandit)
class EpsilonGreedySaver {
  constructor(filePath) {
    this.filePath = filePath;
  }

  save(epsilonGreedy) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(epsilonGreedy.createMemento().state, null, 2));
  }
}

// Reads a list of Interactions from a JSON file holding their names, e.g. ["take a break", "breathing"]
class InteractionFactory {
  static fromNames(names) {
    return names.map((name) => new Interaction(name));
  }

  static fromFile(filePath) {
    return InteractionFactory.fromNames(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  }
}

// Reads an EpsilonGreedy back from a file written by EpsilonGreedySaver.
class EpsilonGreedyFactory {
  static fromFile(filePath) {
    const state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const bandit = new EpsilonGreedy(InteractionFactory.fromNames(state.interactions), state.epsilon);
    bandit.restore(new EpsilonGreedyMemento(state));
    return bandit;
  }
}

module.exports = {
  Interaction, EpsilonGreedy, EpsilonGreedyMemento, EpsilonGreedySaver,
  InteractionFactory, EpsilonGreedyFactory,
};
