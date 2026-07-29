const mongoose = require('mongoose')

const pageContentSchema = new mongoose.Schema({
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  title: {
    type: String,
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  metaDescription: {
    type: String,
    default: '',
  },
}, {
  timestamps: true,
})

// Index for faster slug lookups
pageContentSchema.index({ slug: 1 })

const PageContent = mongoose.model('PageContent', pageContentSchema)

module.exports = PageContent