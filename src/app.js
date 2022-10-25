const express = require('express');
const bodyParser = require('body-parser');

const { Op } = require("sequelize");

const { sequelize } = require('./model')
const { getProfile } = require('./middleware/getProfile')

const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize)
app.set('models', sequelize.models)

/**
 * Contracts by id for specific profile
 * @returns contract by id
 */
app.get('/contracts/:id', getProfile, async (req, res) => {
    const { Contract } = req.app.get('models')
    const { id } = req.params
    const { id: profileId } = req.profile
    const contract = await Contract.findOne({
        where: {
            id, [Op.or]: [{ ContractorId: profileId }, { ClientId: profileId }]
        }
    })
    if (!contract) return res.status(404).end()
    res.json(contract)
})

/**
 * Contracts list for specific profile filter by non terminated contracts
 * @returns contract list
 */
app.get('/contracts', getProfile, async (req, res) => {
    const { Contract } = req.app.get('models')
    const { id: profileId } = req.profile
    const contract = await Contract.findAll({
        where: {
            status: { [Op.or]: ['new', 'in_progress'] },
            [Op.or]: [{ ContractorId: profileId }, { ClientId: profileId }]
        }
    })
    if (!contract) return res.status(404).end()
    res.json(contract)
})

/**
 * Unpaid jobs for specific profile filter by active contracts
 * @returns unpaid jobs
 */
app.get('/jobs/unpaid', getProfile, async (req, res) => {
    const { Job, Contract } = req.app.get('models')
    const { id: profileId } = req.profile
    const job = await Job.findAll({
        where: {
            paid: { [Op.is]: null }
        },
        include: {
            model: Contract,
            where: {
                status: { [Op.or]: ['in_progress'] },
                [Op.or]: [{ ContractorId: profileId }, { ClientId: profileId }]
            }
        }
    })
    if (!job) return res.status(404).end()
    res.json(job)
})

/**
 * Paid a specific job from the current Client
 * @returns current job
 */
app.post('/jobs/:job_id/pay', getProfile, async (req, res) => {
    const { Job, Contract, Profile } = req.app.get('models')
    const { job_id } = req.params
    const { id: profileId } = req.profile

    const job = await Job.findOne({
        where: {
            id: job_id,
            paid: { [Op.is]: null }
        },
        attributes: ['price'],
        include: {
            model: Contract,
            attributes: ['ContractorId', 'ClientId'],
            where: {
                status: { [Op.or]: ['in_progress'] },
                ClientId: profileId
            },
            include: [
                {
                    model: Profile,
                    as: 'Contractor',
                    attributes: []
                },
                {
                    model: Profile,
                    as: 'Client',
                    attributes: ['balance']
                }
            ]
        }
    })

    if (!job) return res.status(404).end()

    let { price, Contract: { ClientId, ContractorId, Client: { balance } } } = job
    const isPayAllow = (balance >= price)
    if (!isPayAllow) {
        return res.status(400).json({
            status: 'fail',
            code: 'PAY_NOT_ALLOWED',
            message: 'A client can only pay if his balance >= the amount to pay.'
        })
    }

    try {
        await sequelize.transaction(async transaction => {
            await Profile.increment({ balance: price }, { where: { id: ContractorId } }, { transaction })
            await Profile.increment({ balance: -price }, { where: { id: ClientId } }, { transaction })
            await Job.update({
                paid: true, paymentDate: Date.now()
            }, {
                where: {
                    id: job_id,
                }
            }, { transaction })
        })
        const payJob = await Job.findByPk(job_id);
        return res.json(payJob)
    } catch (error) {
        return res.status(500).json({
            status: 'fail',
            code: 'UNKNOWN',
            message: 'Payment process fail do to a unknown error.',
            error
        })
    }
})

/**
 * Best profession, those that earned the most money
 * @returns Sum of prices from a specific profession of Contractors
 */
app.get('/admin/best-profession', getProfile, async (req, res) => {
    const { Job, Contract, Profile } = req.app.get('models')
    const { start, end } = req.query
    const job = await Job.findOne({
        include: {
            model: Contract,
            attributes: ['ContractorId'],
            include: {
                model: Profile,
                as: 'Contractor',
                attributes: ['profession']
            }
        },
        attributes: [
            [sequelize.fn('SUM', sequelize.col('price')), 'sum_price']
        ],
        where: {
            paymentDate: {
                [Op.between]: [start, end]
            }
        },
        group: 'Contract.Contractor.profession',
        order: [
            ['sum_price', 'DESC']
        ]
    })
    if (!job) return res.status(404).end()
    res.json(job)
})

/**
 * Best clients, those clients that paid the most for jobs 
 * @returns Sum of prices from Clients with firstName and lastName
 */
app.get('/admin/best-clients', getProfile, async (req, res) => {
    const { Job, Contract, Profile } = req.app.get('models')
    const { start, end, limit: limited } = req.query
    const limit = limited ?? 2
    const job = await Job.findAll({
        include: {
            model: Contract,
            attributes: ['ContractorId'],
            include: {
                model: Profile,
                as: 'Contractor',
                attributes: ['firstName', 'lastName']
            }
        },
        attributes: [
            [sequelize.fn('SUM', sequelize.col('price')), 'sum_price']
        ],
        where: {
            paymentDate: {
                [Op.between]: [start, end]
            }
        },
        group: ['Contract.Contractor.firstName', 'Contract.Contractor.lastName'],
        order: [
            ['sum_price', 'DESC']
        ],
        limit
    })
    if (!job) return res.status(404).end()
    res.json(job)
})

module.exports = app;
