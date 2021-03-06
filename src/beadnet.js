import getName from './namegenerator.js';
import log from './logger.js';
import extendDefaultOptions from './options.js';

const getRandomNumber = function (max) {
	return Math.floor(Math.random() * max);
};

const COMMAND_MAPPING = {
	ADD_NODE: {
		fnName: 'addNode',
		numArgs: 1
	},
	ADD_NODES: {
		fnName: 'addNodes',
		numArgs: 1
	},
	REMOVE_NODE: {
		fnName: 'removeNode',
		numArgs: 1
	},
	ADD_CHANNEL: {
		fnName: 'addChannel',
		numArgs: 1
	},
	ADD_CHANNELS: {
		fnName: 'addChannels',
		numArgs: 1
	},
	REMOVE_CHANNEL: {
		fnName: 'removeChannel',
		numArgs: 2
	},
	CHANGE_CHANNEL_SOURCE_BALANCE: {
		fnName: 'changeChannelSourceBalance',
		numArgs: 3
	},
	CHANGE_CHANNEL_TARGET_BALANCE: {
		fnName: 'changeChannelTargetBalance',
		numArgs: 3
	},
	HIGHLIGHT_CHANNEL: {
		fnName: 'highlightChannel',
		numArgs: 3
	},
	MOVE_BEADS: {
		fnName: 'moveBeads',
		numArgs: 4
	},
	UPDATE_NODE: {
		fnName: 'updateNode',
		numArgs: 2
	}
};

/**
 * Beadnet draws nodes, channels between nodes and channel balances using d3js.
 * Channel balances are drawn as beads on a string and can be moved to visualize
 * funds moving in the Lightning Network.
 */
class Beadnet {

	/**
	 * Create a new BeadNet chart.
	 *
	 * @param {Object} options
	 */
	constructor(options) {
		this._opt = extendDefaultOptions(options);
		log.debug('initializing beadnet with options: ', this._opt);

		/* find the parent container DOM element and insert an SVG */
		this.container = document.querySelector(this._opt.container.selector);
		this.svg = d3.select(this.container)
			.append('svg')
			.attr('class', 'beadnet');

		this.updateSVGSize();

		/* create svg root element called with class "chart" and initial  */
		this.chart = this.svg.append('g')
			.attr('class', 'chart')
			.attr('transform', 'translate(0,0) scale(1)');

		/* create a SVG-container-element for all nodes and all channels */
		this.channelContainer = this.chart.append('g').attr('class', 'channels');
		this.nodeContainer = this.chart.append('g').attr('class', 'nodes');

		this._nodes = [];
		this._channels = [];
		this.beadElements = [];

		this.simulation = this._createSimulation();

		this.updateSimulationCenter();

		this.behaviors = this.createBehaviors();
		this.svg.call(this.behaviors.zoom);

		this._updateNodes();

		if (this._opt.presentation) {
			this._initializePresentation();
		}

		window.addEventListener('resize', this.onResize.bind(this));
	}

	/**
	 * Return the node with the given id.
	 *
	 * @param {String} id - the id of the node to find.
	 * @returns {Node|undefined}
	 */
	_getNodeById(id) {
		return this._nodes.find((node) => node.id == id);
	}

	/**
	 * Return the channel with the given id.
	 *
	 * @param {String} id - the id of the node to find.
	 * @returns {Channel|undefined}
	 */
	_getChannelById(id) {
		return this._channels.find((ch) => ch.id == id);
	}

	/**
	 * Creates a new simulation.
	 *
	 * @returns {d3.forceSimulation} simulation
	 * @private
	 */
	_createSimulation() {
		// return d3.forceSimulation()
		// 	.nodes(this._nodes)
		// 	.alphaDecay(0.1)
		// 	//.force("x", d3.forceX().strength(0))
		// 	//.force("y", d3.forceY().strength(1))
		// 	.force("charge", d3.forceManyBody().strength(-1000).distanceMin(this.forceDistance).distanceMax(3*this.forceDistance))
		// 	//.force("collide", d3.forceCollide(this.forceDistance/6))
		// 	.force("link", d3.forceLink(this._channels).distance(this.forceDistance))
		// 	.force("center", d3.forceCenter(this.width / 2, this.height / 2))
		// 	.alphaTarget(0)
		// 	.on("tick", this._ticked.bind(this));

		return d3.forceSimulation(this._nodes)
			.force('charge', d3.forceManyBody().strength(-7000))
			.force('link', d3.forceLink(this._channels).strength(1).distance(this.forceDistance))
			.force('x', d3.forceX())
			.force('y', d3.forceY())
			.alphaTarget(0)
			.on('tick', this._ticked.bind(this));
	}

	/**
	 * Updates the size of the SVG element to use the full size of it's container.
	 */
	updateSVGSize() {
		this.width = +this.container.clientWidth;
		this.height = +this.container.clientHeight;
		this.forceDistance = (this.width + this.height) * .2;
		this.svg
			.attr('width', this.width)
			.attr('height', this.height);
	}

	/**
	 * Handles a resize event of the window/container.
	 */
	onResize() {
		this.updateSVGSize();
		this.updateSimulationCenter();
		this.createBehaviors();
	}

	/**
	 * Creates the d3js behaviours for zoom and drag&drop.
	 */
	createBehaviors() {
		return {

			zoom: d3.zoom()
				.scaleExtent([0.1, 5, 4])
				.on('zoom', () => this.chart.attr('transform', d3.event.transform)),

			drag: d3.drag()
				.on('start', this._onDragStart.bind(this))
				.on('drag', this._onDragged.bind(this))
				.on('end', this._onDragendEnd.bind(this))
		}
	}

	/**
	 * Forces the simulation to restart at the center of the SVG area.
	 */
	updateSimulationCenter() {
		const centerX = this.svg.attr('width') / 2;
		const centerY = this.svg.attr('height') / 2;
		this.simulation
			.force('center', d3.forceCenter(centerX, centerY))
			.restart();
	}

	/**
	 * Update DOM elements after this._nodes has been updated.
	 * This creates the SVG repensentation of a node.
	 *
	 * @private
	 */
	_updateNodes() {
		const opt = this._opt;

		console.log('_updateNodes: ', this._nodes);

		this._nodeElements = this.nodeContainer
			.selectAll('.node')
			.data(this._nodes, (data) => data.id);

		/* remove deleted nodes */
		this._nodeElements.exit().transition().duration(1000).style('opacity', 0).remove();

		/* create new nodes */
		let nodeParent = this._nodeElements.enter().append('g')
			.attr('class', 'node')
			.attr('id', (data) => data.id)
			.attr('balance', (data) => data.balance)
			.style('stroke', opt.nodes.strokeColor)
			.style('stroke-width', opt.nodes.strokeWidth);

		nodeParent.append('circle')
			.attr('class', 'node-circle')
			.attr('fill', (data) => data.color)
			.attr('r', opt.nodes.radius)
			.style('stroke-width', 0)
			.style('cursor', 'pointer');

		nodeParent.append('circle')
			.attr('class', 'node-circle-onchain')
			.attr('fill', '#666')
			.attr('r', opt.nodes.radius * 0.4)
			.attr('cx', '-15px')
			.attr('cy', '-30px')
			.style('stroke-width', 0)
			.style('cursor', 'pointer');

		nodeParent.append('text')
			.style('stroke-width', 0.5)
			.attr('class', 'node-text-balance')
			.attr('stroke', opt.container.backgroundColor)
			.attr('fill', opt.container.backgroundColor)
			.attr('font-family', 'bitcoinregular')
			.attr('font-size', '12px')
			.attr('text-anchor', 'middle')
			.attr('pointer-events', 'none')
			.attr('x', '-15px')
			.attr('y', '-26px')
			.text((d) => '\u0e3f ' + d.balance);

		nodeParent.append('text')
			.style('stroke-width', 0.5)
			.attr('class', 'node-text-id')
			.attr('stroke', opt.container.backgroundColor)
			.attr('fill', opt.container.backgroundColor)
			.attr('font-family', 'sans-serif')
			.attr('font-size', '15px')
			.attr('y', '0px')
			.attr('text-anchor', 'middle')
			.attr('pointer-events', 'none')
			.text((d) => d.id);

		nodeParent.append('text')
			.style('stroke-width', 0.5)
			.attr('class', 'node-text-offchain-balance')
			.attr('stroke', opt.container.backgroundColor)
			.attr('fill', opt.container.backgroundColor)
			.attr('font-family', 'sans-serif')
			.attr('font-size', '12px')
			.attr('y', '20px')
			.attr('text-anchor', 'middle')
			.attr('pointer-events', 'none')
			.text((d) => '\u26A1 ' + d.offchainBalance);

		nodeParent.call(this.behaviors.drag);

		/* update existing nodes */
		this._nodeElements
			.attr('offchain-balance', (d) => d.offchainBalance)
			.selectAll('.node-text-offchain-balance')
			.text((d) => '\u26A1 ' + d.offchainBalance);
		this._nodeElements
			.attr('balance', (d) => d.balance)
			.selectAll('.node-text-balance')
			.text((d) => '\u0e3f ' + d.balance);

		this.simulation
			.nodes(this._nodes)
			.alphaTarget(1)
			.restart();

		this._nodeElements = this.nodeContainer
			.selectAll('.node');

		return this._nodeElements;
	}

	/**
	 * Adds a new node to the network.
	 *
	 * @param {Node} node
	 * @returns {Beadnet}
	 */
	addNode(node) {
		node = node || {};

		/* initialize with default values */
		node.id = node.id || getName();
		node.balance = node.balance || getRandomNumber(100);
		node.offchainBalance = node.offchainBalance || 0;
		node.color = this._opt.colorScheme(this._nodes.length % 20 + 1);
		//node.color = d3.scaleOrdinal(d3.schemeCategory20)(this._nodes.length % 20 + 1)

		/* save to nodes array */
		this._nodes.push(node);
		this._updateNodes();

		/* make this function chainable */
		return this;
	}

	/**
	 * Adds multible new nodes to the network.
	 *
	 * @param {Array<Node>} nodes
	 * @returns {Beadnet}
	 */
	addNodes(nodes) {
		nodes.forEach((node) => this.addNode(node));

		/* make this function chainable */
		return this;
	}

	updateNode(nodeId, props) {
		const node = this._getNodeById(nodeId);
		if (node) {
			Objects.assign(node, props);
			this._updateNodes();
		}

		/* make this function chainable */
		return this;
	}

	/**
	 * Removes a the node with the given id from the network.
	 *
	 * @param {String} nodeId
	 * @returns {Beadnet}
	 */
	removeNode(nodeId) {
		this._nodes = this._nodes.filter((node) => node.id !== nodeId);
		this._channels = this._channels.filter((channel) => channel.source.id !== nodeId && channel.target.id !== nodeId);

		this._updateNodes();
		this._updateChannels();

		/* make this function chainable */
		return this;
	};

	/**
	 * Create new nodes with random names.
	 *
	 * @param {Number} [count=1] - how many nodes.
	 * @returns {Node}
	 */
	createRandomNodes(count) {
		if ((typeof count !== 'undefined' && typeof count !== 'number') || count < 0) {
			throw new TypeError('parameter count must be a positive number');
		}
		return Array.from(new Array(count), (x) => {
			return {
				id: getName(),
				balance: getRandomNumber(100),
				offchainBalance: 0
			};
		});
	}

	/**
	 * Picks and returns a random node from the list of existing nodes.
	 *
	 * @returns {Node}
	 */
	getRandomNode() {
		return this._nodes[getRandomNumber(this._nodes.length)];
	}

	/**
	 * Re-draw all channels.
	 *
	 * @private
	 * @returns {d3.selection} this._channelElements
	 */
	_updateChannels() {
		const opt = this._opt;

		/* update beads of each channel */
		this._channels = this._channels.map((ch) => {
			const balance = ch.sourceBalance + ch.targetBalance;
			let index = -1;
			ch.beads = [];
			ch.beads.push(...Array.from(new Array(ch.sourceBalance), (x) => {
				index++;
				return {
					state: 0,
					index: index,
					//id: `bead_${ch.id}_source_${index}x${ch.sourceBalance}`
					id: `bead_${ch.id}_source_${index}x${balance}`
				}
			}));
			ch.beads.push(...Array.from(new Array(ch.targetBalance), (x) => {
				index++;
				return {
					state: 1,
					index: index,
					//id: `bead_${ch.id}_target_${index}x${ch.targetBalance}`
					id: `bead_${ch.id}_target_${index}x${balance}`
				}
			}));
			return ch;
		});

		console.log('_updateChannels: ', this._channels);

		this._channelElements = this.channelContainer.selectAll('.channel').data(this._channels, (d) => d.id);

		/* remove channels that no longer exist */
		this._channelElements.exit()
			.transition()
			.duration(500)
			.style('opacity', 0)
			.remove();

		/* create new svg elements for new channels */
		let channelRoots = this._channelElements.enter().append('g')
			.attr('class', 'channel');

		this._channelElements.merge(channelRoots)
			.attr('id', (d) => d.id)
			.attr('source-balance', (d) => d.sourceBalance)
			.attr('target-balance', (d) => d.targetBalance)
			.attr('source-id', (d) => d.source.id)
			.attr('target-id', (d) => d.target.id)
			.attr('highlighted', (d) => d.hightlighted);

		channelRoots
			.append('path')
			.attr('class', 'path')
			.attr('id', (d) => `${d.id}_path`)
			.style('stroke-width', (d) => opt.channels.strokeWidth === 'auto' ? (d.sourceBalance + d.targetBalance) * 2 : opt.channels.strokeWidth)
			.style('stroke', opt.channels.color)
			.style('fill', 'none');

		if (this._opt.channels.showBalance) {
			channelRoots
				.append('text')
				.attr('class', 'channel-text')
				.attr('font-family', 'Verdana')
				.attr('font-size', '12')
				.attr('dx', 150) //TODO: place this dynamic between the beads on the path
				.attr('dy', -7)
				.style('pointer-events', 'none')
				.append('textPath')
				.attr('xlink:href', (d) => `#${d.id}_path`)
				.attr('class', 'channel-text-path')
				.style('stroke-width', 1)
				.style('stroke', opt.channels.color)
				.style('fill', 'none')
				.text((d) => `${d.sourceBalance}:${d.targetBalance}`)
		}

		let beadsContainer = channelRoots.append('g')
			.attr('class', 'beads')
			.attr('id', (d) => 'beads_container');

		this.beadElements = beadsContainer.selectAll('.bead')
			.data((d) => d.beads, (d) => d.id);

		this.beadElements.exit()
			.transition()
			.duration(800)
			.style('opacity', 0)
			.remove();

		let beadElement = this.beadElements.enter().append('g')
			.attr('class', 'bead');

		this.beadElements.merge(beadElement)
			.attr('channel-state', (d) => d.state) //TODO: 0 or 1?
			.attr('id', (d) => d.id)
			.attr('index', (d) => d.index);

		beadElement.append('circle')
			.attr('r', opt.beads.radius)
			.style('stroke-width', opt.beads.strokeWidth)
			.style('fill', opt.beads.color)
			.style('stroke', opt.beads.strokeColor);

		if (opt.beads.showIndex) {
			/* show bead index */
			beadElement.append('text')
				.attr('class', 'bead-text')
				.attr('stroke', opt.container.backgroundColor)
				.attr('fill', opt.container.backgroundColor)
				.attr('font-family', 'sans-serif')
				.attr('font-size', '8px')
				.attr('y', '2px')
				.attr('text-anchor', 'middle')
				.attr('pointer-events', 'none')
				.style('stroke-width', 0.2)
				.text((d) => d.index);
		}

		/* update channel */
		// this._channelElements
		// 	.attr("source-balance", (d) => d.sourceBalance)
		// 	.attr("target-balance", (d) => d.targetBalance)
		// 	.attr("source-id", (d) => d.source.id)
		// 	.attr("target-id", (d) => d.target.id)
		// 	.attr("highlighted", (d) => d.hightlighted);

		// this._channelElements.selectAll(".path")
		// 	.attr("id", (d) =>  `${d.id}_path`)
		// 	.style("stroke-width", opt.channels.strokeWidth)
		// 	.style("stroke", opt.channels.color)
		// 	.style("fill", "none");

		if (this._opt.channels.showBalance) {
			this._channelElements.selectAll('.channel-text-path')
				.text((d) => `${d.sourceBalance}:${d.targetBalance}`);
		}

		/***************************************************/
		/* update channel styles */
		this._channelElements.selectAll('[highlighted=true] .path')
			.style('stroke', opt.channels.colorHighlighted);

		this._channelElements.selectAll('[highlighted=false] .path')
			.style('stroke', opt.channels.color);
		/************************************************* */

		/* update this._paths; needed in this._ticked */
		this._paths = this.channelContainer.selectAll('.channel .path');
		this.beadElements = this.channelContainer.selectAll('.channel .beads .bead');

		this.simulation
			.force('link')
			.links(this._channels);

		this.simulation
			.alphaTarget(0)
			.restart();

		return this._channelElements;
	}

	/**
	 * Creates an unique channel ID using the source and target node IDs and the balances.
	 *
	 * @param {*} channelInfos
	 */
	_getUniqueChannelId(channelInfos) {
		const channelBalance = (+channelInfos.sourceBalance || 0) + (+channelInfos.targetBalance || 0);
		let nonce = 0;
		let id = `channel${channelInfos.source}${channelBalance}${channelInfos.target}${nonce > 0 ? nonce : ''}`;
		while (this._channels.filter((channel) => channel.id === id).length > 0) {
			nonce++;
			id = `channel${channelInfos.source}${channelBalance}${channelInfos.target}${nonce > 0 ? nonce : ''}`;
		}
		return id;
	}

	/**
	 * Adds a new channel.
	 *
	 * @param {Channel} channel
	 */
	addChannel(channel) {
		channel.sourceBalance = channel.sourceBalance || 0;
		channel.targetBalance = channel.targetBalance || 0;

		if (!channel.sourceBalance && !channel.targetBalance) {
			throw new Error('Its not possible to create a channel without any funds. Please add a sourceBalance and/or targetBalance.');
		}

		let source = this._getNodeById(channel.source);
		let target = this._getNodeById(channel.target);

		if (source.balance < channel.sourceBalance) {
			throw new Error('Insufficient Funds. The source node has not enough funds to open this channel');
		}
		if (target.balance < channel.targetBalance) {
			throw new Error('Insufficient Funds. The target node has not enough funds to open this channel');
		}

		/* update balance of the source and target nodes */
		source.balance -= channel.sourceBalance;
		source.offchainBalance += channel.sourceBalance;
		target.balance -= channel.targetBalance;
		target.offchainBalance += channel.targetBalance;
		this._updateNodes();

		/* update the internal channel list */
		const id = this._getUniqueChannelId(channel);
		this._channels.push({
			id: id,
			hightlighted: false,
			source: source,
			target: target,
			sourceBalance: channel.sourceBalance,
			targetBalance: channel.targetBalance
		});
		this._updateChannels();

		return this;
	}

	/**
	 * Adds an array of channels.
	 *
	 * @param {*} channels
	 */
	addChannels(channels) {
		channels.forEach((channel) => this.addChannel(channel));
	}

	/**
	 * Create new nodes with random names.
	 *
	 * @param {Number} [count=1] - how many nodes.
	 * @param {Boolean} [unique=true] - should channels be unique?
	 * @returns {Node}
	 */
	createRandomChannels(count, unique = true) {
		// if ((typeof count !== "undefined" && typeof count !== "number") || count < 0) {
		// 	throw new TypeError("parameter count must be a positive number");
		// }
		return Array.from(new Array(count), (x) => {
			let source = this.getRandomNode();
			let target = this.getRandomNode();

			if (unique) {
				let killCounter = 0;
				while ((
					source.id === target.id ||
					(this.getChannels(source.id, target.id).length > 0) &&
					killCounter < this._channels.length)) {
					source = this.getRandomNode();
					target = this.getRandomNode();
					killCounter++;
				}
			}

			let sourceBalance = getRandomNumber(4);
			let targetBalance = getRandomNumber(4);
			sourceBalance = (!sourceBalance && !targetBalance) ? getRandomNumber(4) + 1 : sourceBalance;

			let channel = {
				source: source.id,
				target: target.id,
				sourceBalance: sourceBalance,
				targetBalance: targetBalance
			};
			channel.id = this._getUniqueChannelId(channel);
			return channel;
		});
	}

	/**
	 * Picks and returns a random channel from the list of existing channels.
	 */
	getRandomChannel() {
		return this._channels[getRandomNumber(this._channels.length)];
	}

	/**
	 * Returns the number of channels.
	 * @returns {Number} number of channels
	 */
	getChannelCount() {
		return this._channels.length;
	}

	/**
	 * Remove channel with the given source and target ids.
	 *
	 * @returns {Beadnet} beadnet
	 */
	removeChannel(sourceId, targetId) {
		this._channels = this._channels.filter((channel) => {
			if ((channel.source.id !== sourceId) || (channel.target.id !== targetId)) {
				return true;
			} else {
				let sourceNode = this._getNodeById(sourceId);
				sourceNode.balance += channel.sourceBalance;
				sourceNode.offchainBalance -= channel.sourceBalance;
				let targetNode = this._getNodeById(targetId);
				targetNode.balance += channel.targetBalance;
				targetNode.offchainBalance -= channel.targetBalance;
				return false;
			}
		});

		console.log('removeChannel: ', this._channels);
		this._updateNodes();
		this._updateChannels();

		return this;
	}

	/**
	 * Returns all channels that exist between two nodes.
	 *
	 * @param {String} sourceId
	 * @param {String} targetId
	 * @returns {Channel[]} channels
	 */
	getChannels(sourceId, targetId) {
		return this._channels.filter((channel) =>
			(channel.source.id === sourceId && channel.target.id === targetId) ||
			(channel.target.id === sourceId && channel.source.id === targetId)
		);
	}

	/**
	 * Transfer a amount from the source node balance to or from the channel.
	 *
	 * @param {String} sourceId - source node id
	 * @param {String} targetId - target node id
	 * @param {Number} amount - positive if moved from not to channel; negative if moved from channel to node.
	 * @returns {Beadnet} beadnet
	 */
	changeChannelSourceBalance(sourceId, targetId, amount) {
		const channels = this.getChannels(sourceId, targetId);
		if (!channels || channels.length <= 0) {
			//TODO: throw an error
			console.error(`no channel found between "${sourceId}" and "${targetId}"`);
			return this;
		}
		//TODO: handle error if more than one channel is found.
		let channel = channels[0];
		let node = this._getNodeById(channel.source.id);
		//TODO: throw error if node not found;

		if (amount > 0) {
			amount = Math.abs(amount);
			if (node.balance < amount) {
				//TODO: throw an error
				console.error(`node ${sourceId} has not enough balance (${node.balance}) to refund the channel by ${amount}`);
				return this;
			}
			node.balance -= amount;
			node.offchainBalance += amount;
			channel.sourceBalance += amount;
		} else {
			amount = Math.abs(amount);
			if (channel.sourceBalance < amount) {
				//TODO: throw an error
				console.error(`sourceBalance (${sourceId}) is not enough (${channel.sourceBalance}) to remove an amount of ${amount}`);
				return this;
			}
			node.balance += amount;
			node.offchainBalance -= amount;
			channel.sourceBalance -= amount;
		}

		this._updateNodes();
		this._updateChannels();

		return this;
	}

	/**
	 * Transfer a amount from the target node banlance to or from the channel.
	 *
	 * @param {String} sourceId - source node id
	 * @param {String} targetId - target node id
	 * @param {Number} amount - positive if moved from node to channel; negative if moved from channel to node.
	 * @returns {Beadnet} beadnet
	 */
	changeChannelTargetBalance(sourceId, targetId, amount) {
		const channels = this.getChannels(sourceId, targetId);
		if (!channels || channels.length <= 0) {
			//TODO: throw an error
			console.error(`no channel found between "${sourceId}" and "${targetId}"`);
			return this;
		}
		//TODO: handle error if more than one channel is found.
		let channel = channels[0];
		let node = this._getNodeById(channel.target.id);
		//TODO: throw error if node not found;

		if (amount > 0) {
			amount = Math.abs(amount);
			if (node.balance < amount) {
				//TODO: throw an error
				console.error(`node ${targetId} has not enough balance (${node.balance}) to refund the channel by ${amount}`);
				return this;
			}
			node.balance -= amount;
			node.offchainBalance += amount;
			channel.targetBalance += amount;
		} else {
			amount = Math.abs(amount);
			if (channel.targetBalance < amount) {
				//TODO: throw an error
				console.error(`targetBalance (${targetId}) is not enough (${channel.targetBalance}) to remove an amount of ${amount}`);
				return this;
			}
			node.balance += amount;
			node.offchainBalance -= amount;
			channel.targetBalance -= amount;
		}

		this._updateNodes();
		this._updateChannels();

		return this;
	}

	/**
	 * Mark a channel as "highlighted".
	 *
	 * @param {String} sourceId
	 * @param {String} targetId
	 * @param {Boolean} state - should the channel be highlighted [true]/false
	 * @returns {Beadnet}
	 */
	highlightChannel(sourceId, targetId, state) {
		let channels = this.getChannels(sourceId, targetId);
		channels.forEach((channel) => channel.hightlighted = state ? state : !channel.hightlighted);

		this._updateChannels();

		/* make this function chainable */
		return this;
	}

	/**
	 * Calculate and then translate a bead to a certain position.
	 *
	 * @param {*} b
	 * @returns {string} bead position.
	 */
	_positionBead(b, d) {
		const bead = d3.select(b);
		const index = d.index;
		const state = +bead.attr('channel-state'); // state 0=source, 1=target
		const channel = d3.select(bead.node().parentNode.parentNode);
		const path = channel.select('.path').node();

		const channelData = channel.data()[0];
		const sourceBalance = channelData.sourceBalance;
		const targetBalance = channelData.targetBalance;
		const balance = sourceBalance + targetBalance;
		const distanceBetweenBeads = this._opt.beads.distance + this._opt.beads.spacing;
		const channelPadding = this._opt.beads.firstPosition + this._opt.beads.spacing;

		let startPosition = channelPadding + (index * distanceBetweenBeads);
		let endPosition = channelPadding + ((balance - 1 - index) * distanceBetweenBeads);
		let totalDistance = path.getTotalLength() - startPosition - endPosition;

		const beadPosition = path.getPointAtLength(startPosition + state * totalDistance);
		return `translate(${beadPosition.x},${beadPosition.y})`;
	}

	/**
	 * Handle an animation tick.
	 *
	 * @private
	 */
	_ticked() {
		if (this._nodeElements) {
			this._nodeElements.attr('transform', (data) => `translate(${data.x},${data.y})`);
		}
		if (this._paths) {
			this._paths.attr('d', (d) => {
				// var count = this._channels.filter((c) => ((d.source.id === d.source.id) && (d.target.id === d.target.id))).length;
				// if (count <= 1) {
				return `M${d.source.x},${d.source.y} ${d.target.x},${d.target.y}`;
				// } else {
				// 	var dx = d.target.x - d.source.x;
				// 	var dy = d.target.y - d.source.y;
				// 	var dr = Math.sqrt((dx*dx+count) + (dy*dy+count));
				// 	return `M${d.source.x},${d.source.y}A${dr},${dr} 0 0,1 ${d.target.x},${d.target.y}`;
				// }
			});
		}
		this.tickedBeads();
	}

	/**
	 * Handle bead animation.
	 */
	tickedBeads() {
		let that = this;
		if (!this.beadElements || this.beadElements.length === 0 || this.beadElements.empty()) {
			return;
		}
		this.beadElements.attr('transform', function (d) {
			return that._positionBead(this, d);
		});
	}

	/**
	 * Animates a bead movement.
	 *
	 * @param {*} bead
	 * @param {*} direction
	 * @param {*} delay
	 */
	animateBead(bead, direction, delay) {
		let that = this;
		direction = !!direction;
		const select = d3.select(bead);
		return select.transition()
			.delay(delay)
			//.ease(d3.easeLinear)
			.ease(d3.easeQuadInOut)
			.duration(1000)
			.attrTween('channel-state', function (a) {
				return function (t) {
					that.tickedBeads();
					if (direction) {
						return 1 - t;
					} else {
						return t
					}
				}
			});
	}

	/**
	 * Moves a certain amount of beads from source to target node. If a callback is provided, it is called after the animation
	 * has stopped.
	 *
	 * @param {*} sourceId
	 * @param {*} targetId
	 * @param {*} beadCount
	 * @param {*} callback
	 * @returns {Beadnet} beadnet
	 */
	moveBeads(sourceId, targetId, beadCount, callback) {
		const channels = this.getChannels(sourceId, targetId);

		let channel = channels[0];
		if (!channel) {
			//TODO: throw error!?
			console.error('no channel found!');
			return;
		}

		// TODO: get channel with source and target
		const channelElement = d3.select(`#${channel.id}`);

		if (channel.source.id === sourceId) {

			let sourceBalance = channel.sourceBalance;
			let targetBalance = channel.targetBalance;
			let startIndex = sourceBalance - beadCount;
			let endIndex = startIndex + beadCount - 1;

			let that = this;
			let transitionCounter = 0;
			channelElement.selectAll('.bead').each(function (d, index) {
				if (index >= startIndex && index <= endIndex) {
					const delay = (endIndex - index) * 100;
					transitionCounter++;
					that.animateBead(this, d.state, delay).on('end', (ch, a, b) => {
						sourceBalance--;
						targetBalance++;
						d.state = 1;

						channel.sourceBalance = sourceBalance;
						channel.source.offchainBalance--;
						channel.targetBalance = targetBalance;
						channel.target.offchainBalance++;
						that._updateChannels();
						that._updateNodes();

						channelElement
							.attr('source-balance', sourceBalance)
							.attr('target-balance', targetBalance);

						if (that._opt.channels.showBalance) {
							channelElement.select('.channel-text-path')
								.text(`${sourceBalance}:${targetBalance}`);
						}

						transitionCounter--;
						if (transitionCounter <= 0) {
							return callback && callback();
						}
					});
				}
			});

		} else {

			let sourceBalance = channel.sourceBalance;
			let targetBalance = channel.targetBalance;
			let startIndex = (sourceBalance + targetBalance) - targetBalance;
			let endIndex = startIndex + beadCount - 1;

			let that = this;
			let transitionCounter = 0;
			channelElement.selectAll('.bead').each(function (d, index) {
				if (index >= startIndex && index <= endIndex) {
					const delay = (index) * 100;
					transitionCounter++;
					that.animateBead(this, d.state, delay).on('end', (ch, a, b) => {
						sourceBalance++;
						targetBalance--;
						d.state = 0;

						channel.sourceBalance = sourceBalance;
						channel.source.offchainBalance++;
						channel.targetBalance = targetBalance;
						channel.target.offchainBalance--;
						that._updateChannels();
						that._updateNodes();

						channelElement
							.attr('source-balance', sourceBalance)
							.attr('target-balance', targetBalance);

						if (that._opt.channels.showBalance) {
							channelElement.select('.channel-text-path')
								.text(`${sourceBalance}:${targetBalance}`);
						}

						transitionCounter--;
						if (transitionCounter <= 0) {
							return callback && callback();
						}
					});
				}
			});

		}

		return this;
	}

	/**
	 * Handles the start of mouse drag event.
	 *
	 * @private
	 */
	_onDragStart(d) {
		if (!d3.event.active) {
			this.simulation
				.alphaTarget(0.1)
				.restart();
		}
		d.fx = d.x;
		d.fy = d.y;
	}

	/**
	 * Handles the mouse drag event.
	 *
	 * @private
	 */
	_onDragged(d) {
		d.fx = d3.event.x;
		d.fy = d3.event.y;
	}

	/**
	 * Handles the end of mouse drag event.
	 *
	 * @private
	 */
	_onDragendEnd(d) {
		if (!d3.event.active) {
			this.simulation
				.alphaTarget(0);
		}
		d.fx = null;
		d.fy = null;
	}

	/**
	 * Initialize presentation mode, check if the provided steps are valid.
	 *
	 * @private
	 */
	_initializePresentation() {
		if (this._opt.presentation && this._opt.presentation.steps && this._opt.presentation.steps.length > 0) {
			this.presentation = {
				currentState: 0,
				steps: this._opt.presentation.steps,
			};
			this.presentation.steps.forEach(step => {
				step.forEach(subStep => {
					let fnMapping = COMMAND_MAPPING[subStep.cmd];
					if (fnMapping) {
						if (!subStep.args || subStep.args.length === 0 || subStep.args.length !== fnMapping.numArgs) {
							console.error('the command ' + subStep.cmd + ' requires exactly ' + fnMapping.numArgs + ' arguments!')
						}
					} else {
						console.error('invalid command ' + subStep.cmd + '!');
					}
				})
			});
		} else {
			console.error('presentation must be an object that contains one or more steps');
		}
	}

	/**
	 * Show the next step of the presentation. Only has an effect if the instance was initialized in presentation mode.
	 */
	nextStep() {
		if (!this.presentation) {
			const err = 'not in presentation mode! please pass a presentation object when creating the beadnet.';
			console.log(err);
			return err;
		}
		if (this.presentation.currentState >= this.presentation.steps.length) {
			const err = 'presentation reached its end. please restart it.';
			console.log(err);
			return err;
		}
		let script = this.presentation.steps[this.presentation.currentState];
		let description = '';
		if ((typeof script[0]) === 'string') {
			description = script.shift();
		}
		let bn = this;
		script.forEach(subStep => {
			let fnMapping = COMMAND_MAPPING[subStep.cmd];
			let fn = bn[fnMapping.fnName];
			fn.apply(bn, subStep.args);
		});
		this.presentation.currentState++;
		return description;
	}
}

export default Beadnet;
