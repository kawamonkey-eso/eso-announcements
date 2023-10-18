const cheerio = require('cheerio')
const { Feed } = require('feed')
const { writeFile } = require('fs/promises')
const fetchOpts = {headers: {'User-Agent': 'Googlebot'}}
const fetchDomain = 'https://www.elderscrollsonline.com'

async function getNews() {
	const response = await fetch(fetchDomain + '/en-us/news/category/announcements', fetchOpts)
	const html = await response.text()
	const regex = /link-block.+?href="(.+?)"/gs
	const output = []
	let m

	while ((m = regex.exec(html)) !== null) {
		output.push(await getNewsPost(m[1]))
	}

	return output
}

async function getNewsPost(slug) {
	const url = fetchDomain + slug
	const response = await fetch(url, fetchOpts)
	const html = await response.text()
	const $ = cheerio.load(html)
	const title = $('h1').text().replace(/’/g, '\'').trim()
	const date = new Date($('span.date').text())
	const leadImg = $('.lead-img').first().attr('src')
	const description = $('.text_block i').first().text().replace(/’/g, '\'').replace(/\n /g, ' ').replace(/ +/g, ' ').trim()
	const categories = [{name: 'News'}]
	let content = `<img src="${leadImg}" />`

	for (const a of $('.post-title .tags a')) {
		const name = $(a).text().trim()

		if (name != 'Announcements') {
			categories.push({name})
		}
	}

	for (const div of $('.blog-body-box > div[id]')) {
		if (div.attribs.id.startsWith('blog_images')) {
			// iterate images
			for (const a of $(div).find('.zl-link')) {
				content += `\n<p><img src="${a.attribs.href}" /></p>\n`
			}
		} else if (div.attribs.id.startsWith('blog_videos')) {
			const embedUrl = $('a[href^="https://youtube.com/embed/"]', div).attr('href').replace('/embed/', '/v/')
			const imgSrc = $('img.preview', div).attr('data-lazy-src')

			content += `\n<p><a href="${embedUrl}"><img src="${imgSrc}" /></a></p>\n`
		} else if (div.attribs.id.startsWith('text_block')) {
			// get child HTML contents
			for (const child of div.children) {
				if ($(child).html()) {
					content += $(child).html().replace(/’/g, '\'').trim()
				}
			}
		}
	}

	// remove unwanted tags
	content = content.replace(/ (?:class|data-.*?)=".+?"/g, '')

	// clean up whitespace
	content = content
		.replace(/<[bi]> <\/[bi]>/g, ' ')
		.replace(/(?:\n |&nbsp;)/g, ' ')
		.replace(/\n\s+\n/g, "\n")
		.replace(/\n+/g, "\n")
		.replace(/ +/g, ' ')

	return {
		title,
		link: url,
		date,
		content,
		category: categories,
		description,
		image: leadImg,
	}
}

async function getThread(url) {
	const response = await fetch(url)
	const html = await response.text()
	const $ = cheerio.load(html)
	const output = []
	let date

	// iterate messages
	for (const item of $('#Content .Item')) {
		// only iterate over initial Staff items
		if (!$(item).hasClass('Rank-Staff')) {
			break
		}

		date = $('.DateCreated time', item).attr('datetime')

		let html = $('.Message', item).html().trim()

		// fix broken list tags
		let extraList

		while ((extraList = /<\/ul>(.+?)\[\/list\]/s.exec(html)) !== null) {
			html = html.replace(extraList[0], extraList[1].replace(/\[\*\](.+?)<br>/g, '<li>$1</li>')) + '</ul>'
		}

		// remove curly quote marks
		html = html.replace(/’/g, '\'').replace(/[“”]/g, '"')

		// remove unwanted attributes
		html = html.replace(/ (?:alt|class|rel|srcset)=".+?"/g, '')
		
		output.push(html)
	}

	return [new Date(date), output]
}

async function getForum() {
	const url = 'https://forums.elderscrollsonline.com/en/categories/general-discussion'
	const response = await fetch(url)
	const html = await response.text()
	const $ = cheerio.load(html)
	const output = []

	// remove icons
	$('.Item.Announcement .Title .icon').remove()

	for (const item of $('.Item.Announcement')) {
		const title = $('.Title', item)
		const titleText = title.text().trim()
		const titleTextLC = titleText.toLowerCase()
		const firstUser = $('.FirstUser .UserLink', item)

		if (titleText != 'Community Rules' && !titleTextLC.includes('forum') && !titleTextLC.includes('thread')) {
			const url = title.attr('href')
			const [date, thread] = await getThread(url)

			output.push({
				title: titleText,
				link: url,
				description: '',
				content: thread.join(),
				category: [{name: "Forum"}],
				author: [
					{
						name: firstUser.text().trim(),
						link: firstUser.attr('href')
					}
				],
				date
			})
		}
	}

	return output
}

;(async () => {
	let results = await Promise.all([getNews(), getForum()])
	results = results.flat()
	results.sort((a, b) => b.date - a.date)

	const feed = new Feed({
		title: "ESO Announcements",
		description: "Combined ESO blog and forum post announcements feed",
		link: "https://www.elderscrollsonline.com/",
		language: "en-us",
		favicon: "https://www.elderscrollsonline.com/favicon.ico",
		updated: results[0].date,
		generator: "Magic"
	})

	for (const item of results) {
		feed.addItem(item)
	}

	await writeFile('feed.rss', feed.rss2())
})()