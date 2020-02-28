const events = require('events')
class Discovery 
{
    constructor(id, name, options)
    {
        this.events = new events()
    }

    async start()
    {
        throw new Error('Discovery not implemented.');
    }

    async stop()
    {
        throw new Error('Discovery not implemented.');
    }

    async search()
    {
        throw new Error('Discovery not implemented.');
    }

    async publish()
    {
        throw new Error('Discovery not implemented.');
    }
}

module.exports = Discovery;