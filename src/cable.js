import actioncable from './actioncable';
import Logger from './logger';
import Mixin from './mixin';

export default class Cable {
	_logger = null;
	_cable = null;
	_channels = { subscriptions: {} };
	_contexts = {};

	/**
	 * ActionCableVueJwt $cable entry point
	 * @param {Object} Vue
	 * @param {Object} options - ActionCableVue options
	 * @param {string} options.connectionUrl - ActionCable server websocket URL
	 * @param {boolean} options.debug - Enable logging for debug
	 * @param {string} options.debugLevel - Debug level required for logging. Either `info`, `error`, or `all`
	 * @param {function} jwt - Function that can be called to retrieve the JSON Web Token for the current user
	 */
	constructor(Vue, options) {
		Vue.prototype.$cable = this;
		Vue.mixin(Mixin);

		const { debug, debugLevel, connectionUrl, connectImmediately, jwt } = options || {
			debug: false,
			debugLevel: 'error',
			connectionUrl: null,
			connectImmediately: true,
			jwt: function() { return null }
		};

		this._logger = new Logger(debug, debugLevel);
		if (connectImmediately) this._connect(connectionUrl);
	}

	/**
	 * Subscribes to an Action Cable server channel
	 * @param {Object} subscription
	 * @param {string} subscription.channel - The name of the Action Cable server channel
	 * @param {string} subscription.room - The room in the Action Cable server channel to subscribe to
	 * @param {string} name - A custom channel name to be used in component
	 */
	subscribe(subscription, name) {
		if (this._cable) {
			const that = this;
			const channelName = name || subscription.channel;

			this._channels.subscriptions[
				channelName
			] = this._cable.subscriptions.create(subscription, {
				connected() {
					that._fireChannelEvent(channelName, that._channelConnected);
				},
				disconnected() {
					that._fireChannelEvent(channelName, that._channelDisconnected);
				},
				rejected() {
					that._fireChannelEvent(channelName, that._subscriptionRejected);
				},
				received(data) {
					that._fireChannelEvent(channelName, that._channelReceived, data);
				}
			});
		} else {
			throw new Error(`ActionCableVueJWT not initialized.`);
		}
	}

	/**
	 * Perform an action in an Action Cable server channel
	 * @param {Object} whatToDo
	 * @param {string} whatToDo.channel - The name of the Action Cable server channel / The custom name chosen for the component channel
	 * @param {string} whatToDo.action - The action to call in the Action Cable server channel
	 * @param {Object} whatToDo.data - The data to pass along with the call to the action
	 */
	perform(whatToDo) {
		const { channel, action, data } = whatToDo;
		this._logger.log(
			`Performing action '${action}' on channel '${channel}'.`,
			'info'
		);
		const subscription = this._channels.subscriptions[channel];
		if (subscription) {
			subscription.perform(action, data);
			this._logger.log(
				`Performed '${action}' on channel '${channel}'.`,
				'info'
			);
		} else {
			throw new Error(
				`You need to be subscribed to perform action '${action}' on channel '${channel}'.`
			);
		}
	}

	/**
	 * Unsubscribes from an Action Cable server channel
	 * @param {string} channelName - The name of the Action Cable server channel / The custom name chosen for the component channel
	 */
	unsubscribe(channelName) {
		this._removeChannel(channelName);
	}

	/**
	 * Called when a subscription to an Action Cable server channel successfully completes. Calls connected on the component channel
	 * @param {Object} channel - The component channel
	 */
	_channelConnected(channel) {
		if (channel.connected)
			channel.connected.call(this._contexts[channel._uid].context);

		this._logger.log(
			`Successfully connected to channel '${channel._name}'.`,
			'info'
		);
	}

	/**
	 * Called when a subscription to an Action Cable server channel disconnects. Calls disconnected on the component channel
	 * @param {Object} channel - The component channel
	 */
	_channelDisconnected(channel) {
		if (channel.disconnected)
			channel.disconnected.call(this._contexts[channel._uid].context);

		this._logger.log(
			`Successfully disconnected from channel '${channel._name}'.`,
			'info'
		);
	}

	/**
	 * Called when a subscription to an Action Cable server channel is rejected by the server. Calls rejected on the component channel
	 * @param {Object} channel - The component channel
	 */
	_subscriptionRejected(channel) {
		if (channel.rejected)
			channel.rejected.call(this._contexts[channel._uid].context);

		this._logger.log(`Subscription rejected for channel '${channel._name}'.`);
	}

	/**
	 * Called when a message from an Action Cable server channel is received. Calls received on the component channel
	 * @param {Object} channel - The component channel
	 */
	_channelReceived(channel, data) {
		if (channel.received)
			channel.received.call(this._contexts[channel._uid].context, data);

		this._logger.log(`Message received on channel '${channel._name}'.`, 'info');
	}

	/**
	 * Connects to an Action Cable server
	 * @param {string} url - The websocket URL of the Action Cable server.
	 * @param {function} jwt - A function to retrieve the JSON Web Token to use
	 */
	_connect(url, jwt) {
		if (typeof url == 'string') this._cable = actioncable.createConsumer(url, jwt());
		else {
			throw new Error(
				'Connection URL needs to be a valid Action Cable websocket server URL.'
			);
		}
	}

	/**
	 * Component mounted. Retrieves component channels for later use
	 * @param {string} name - Component channel name
	 * @param {Object} value - The component channel object itself
	 * @param {Object} context - The execution context of the component the channel was created in
	 */
	_addChannel(name, value, context) {
		value._uid = context._uid;
		value._name = name;

		this._channels[name] = value;
		this._addContext(context);
	}

	/**
	 * Adds a component to a cache. Component is then used to bind `this` in the component channel to the Vue component's execution context
	 * @param {Object} context - The Vue component execution context being added
	 */
	_addContext(context) {
		if (!this._contexts[context._uid]) {
			this._contexts[context._uid] = { context, users: 1 };
		} else {
			++this._contexts[context._uid].users;
		}
	}

	/**
	 * Component is destroyed. Removes component's channels, subscription and cached execution context.
	 */
	_removeChannel(name) {
		const uid = this._channels[name]._uid;

		this._channels.subscriptions[name].unsubscribe();
		delete this._channels[name];
		delete this._channels.subscriptions[name];

		--this._contexts[uid].users;
		if (this._contexts[uid].users <= 0) delete this._contexts[uid];

		this._logger.log(`Unsubscribing from channel '${name}'.`, 'info');
	}

	/**
	 * Fires the event triggered by the Action Cable subscription on the component channel
	 * @param {string} channelName - The name of the Action Cable server channel / The custom name chosen for the component channel
	 * @param {Function} callback - The component channel event to call
	 * @param {Object} data - The data passed from the Action Cable server channel
	 */
	_fireChannelEvent(channelName, callback, data) {
		if (this._channels.hasOwnProperty(channelName)) {
			const channel = this._channels[channelName];
			callback.call(this, channel, data);
		}
	}
}
