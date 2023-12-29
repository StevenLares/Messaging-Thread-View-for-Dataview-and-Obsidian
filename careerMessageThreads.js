
function getPath(link){
    return link.substring(2, link.length - 2);
}

function getLink(path){
    return "[[" + path + "]]"
}

function getPage(path){
    return dv.page(path);
}

function getFrontmatter(page){
    return page.file.frontmatter;
}

function getTags(page){
    return page.file.tags;
}


//increments occurence of an item in an object
function addOccurence(item, dictionary){
	if (typeof dictionary[item] != "undefined") {
        dictionary[item]++;
	}
	else {
		dictionary[item] = 1;
	}
}



// tallys job occurences, company occurences, and contact occurences given a message page
// this is meant to be run for every message in a given thread so that the tallies add up to the
// total count for each metadata type.
function tallyUniqueMetaData(page, job_occurences, company_occurences, contact_occurences){
    let frontmatter = getFrontmatter(page)

    // Tallies both job position and company at the same time, since the latter is extracted from the former
    if(frontmatter.job_position != null){
        addOccurence(frontmatter.job_position, job_occurences)
        frontmatter = getFrontmatter(getPage(getPath(frontmatter.job_position)))
        if(frontmatter.company != null){
            addOccurence(frontmatter.company, company_occurences)
        }
    }

    frontmatter = getFrontmatter(page)

    if(frontmatter.contacts != null){
        addOccurence(frontmatter.contacts, contact_occurences)
    }


}


// finds date given a discussion, sent message, or received message
// accounts for unsent drafts and upcoming discussions for final messages and otherwise
function findDate(page, isFinalMessage) {
	const tags = getTags(page)
	const frontmatter = getFrontmatter(page)


    // found_date differs depending on if the sent message  (or discussion) is the initial message in
    // the thread or the final one.
    // A received message's date decision is the same for any message
	if(tags.includes("#comms/discussions")){
		const discussion_date = frontmatter.discussion_date
		const date_drafted = frontmatter.date_drafted
		const found_date = isFinalMessage ?
		(!discussion_date ? date_drafted : discussion_date) :
		(!date_drafted ? discussion_date : date_drafted)

		return found_date

	}

	if(tags.includes("#comms/messages/sent")){
		const date_sent = frontmatter.date_sent
		const date_drafted = frontmatter.date_drafted

		const found_date = isFinalMessage ?
		(!date_sent ? date_drafted : date_sent ) :
		(!date_drafted ? date_sent :  date_drafted)

		return found_date

	}

	if(tags.includes("#comms/messages/received")){
		const date_received = frontmatter.date_received
		const created_date = page.file.cday
		const found_date = !date_received ? created_date : date_received

		return found_date
	}

	return null
}


function checkIfMessageWasSent(page){
    return getTags(page).includes("#comms/messages/sent") && getFrontmatter(page).date_sent
}

function checkIfMessageWasReceived(page){
    return getTags(page).includes("#comms/messages/received") && getFrontmatter(page).date_received;
}


function calculate_draft_and_response_stats(current_page, previous_page, sent_message_counts, total_draft_time, response_message_counts, total_response_time) {

    // Checks if current message was sent. This is critical
    // for both sets of stats.
    let was_current_message_sent = checkIfMessageWasSent(current_page);

    // Assuming the current message was actually sent, then it
    // increments the sent_message_counts
    // and adds to the total_draft_time
    if(was_current_message_sent){
        sent_message_counts++;

        let date_sent = getFrontmatter(current_page).date_sent;
        let date_drafted = getFrontmatter(current_page).date_drafted;
        total_draft_time+= calculate_time_interval_in_days(date_sent, date_drafted);
    }

    // The previous page should only be null when checking the initial
    // message in a thread
    if(previous_page != null){
        // Only consider it a received message if it has a date_received.
        // Otherwise, you need to go back and add it
        let was_previous_message_received = checkIfMessageWasReceived(previous_page);

        // a response is a sent message right after a previously received message
        let was_current_message_a_response = was_previous_message_received && was_current_message_sent;

        // Assuming the current message was a response, then it
        // increments the response_message_counts
        // also adds to the total_response_time
        if(was_current_message_a_response){
            response_message_counts++;
            let date_sent = getFrontmatter(current_page).date_sent;
            let date_received = getFrontmatter(previous_page).date_received;
            total_response_time+= calculate_time_interval_in_days(date_sent, date_received)
        }


    }

    return [sent_message_counts, total_draft_time, response_message_counts, total_response_time];



}

function calculate_time_interval_in_days(later_date, earlier_date){
    const diffTime = Math.abs(Date.parse(later_date) - Date.parse(earlier_date));
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;

}


function calculate_time_averages(sum_of_time_intervals, message_counts){
    return !message_counts ? 0 : sum_of_time_intervals / message_counts;
}


function meetsAllUserFilters(job_occurences, job_position_filter, company_occurences, company_filter, contact_occurences, contact_filter){
    const job_position_match = job_position_filter == null ? true : matchesFilter(job_occurences, job_position_filter);
    const company_match = company_filter == null ? true : matchesFilter(company_occurences, company_filter);
    const contact_match = contact_filter == null ? true : matchesFilter(contact_occurences, contact_filter);

    return job_position_match && company_match && contact_match;

}

function matchesFilter(occurence_object, filter){
    const occurences = Object.keys(occurence_object)
    return occurences.length == 0 ? false : occurences.join().includes(filter)


}

// https://stackoverflow.com/questions/5435228/sort-an-array-with-arrays-in-it-by-string
function Comparator(a, b) {
    if (a[1] < b[1]) return 1;
    if (a[1] > b[1]) return -1;
    return 0;
}


// This function generates messages threads for the career domain
// By default, there is no filtering based on jobs, companies, or contacts
// However, the user can add a combination of one job, one company, or one contact to filter on
// In that case, only rows that meet all conditions will appear in the thread.
function generate(job_position_filter = null, company_filter = null, contact_filter = null){
    const headers = ["first_message_date", "last_message_date", "thread_duration", "first_message", "last_message", "number_of_messages", "job_positions", "companies", "contacts", "average_days_to_draft", "average_days_to_respond"];

    const rows = []
    const initial_messages = dv.pages("#domain/career and #comms/thread_starter and -#index");



    /*
    this for loop goes through all messaging threads starting at the initial message.
    For each thread, it attempts to enter a while loop that iterates through
    the next_message properties until it arrives at the final one in the chain.
    While iterating through the thread, it aggregates all requested data
    into the rows array, as an array of arrays.
    */
    for (let i = 0; i < initial_messages.length; i++) {
        const row = [];

        // counting and summation variables
        let message_count = 1;

        let sent_message_counts = 0;
        let total_draft_time = 0;

        let response_message_counts = 0;
        let total_response_time = 0;

        // stores number of occurences for each metadata type and value in the
        // current messaging thread
        let job_occurences = {};
        let company_occurences = {};
        let contact_occurences = {};


        // Will tally metadata and calculate stats for the initial message
        tallyUniqueMetaData(initial_messages[i], job_occurences, company_occurences, contact_occurences)

        let stats = calculate_draft_and_response_stats(initial_messages[i], null, sent_message_counts, total_draft_time, response_message_counts, total_response_time)
        sent_message_counts = stats[0];
        total_draft_time = stats[1];


        // Initial page logic
        let final_message_page = initial_messages[i];
        let next_message_path = getFrontmatter(final_message_page).next_message;

        while(next_message_path !== null){
            message_count++;

            let previous_message_page = final_message_page;
            final_message_page = getPage(getPath(next_message_path));


            tallyUniqueMetaData(final_message_page, job_occurences, company_occurences, contact_occurences);

            stats = calculate_draft_and_response_stats(final_message_page, previous_message_page, sent_message_counts, total_draft_time, response_message_counts, total_response_time)

            sent_message_counts = stats[0];
            total_draft_time = stats[1];
            response_message_counts = stats[2];
            total_response_time = stats[3];

            // Updates the path for the next while loop iteration
            next_message_path = getFrontmatter(final_message_page).next_message;


        }


        // If it meets the user's search filters, then it will proceed to create the row
        // and then add it to the table.
        if (meetsAllUserFilters(job_occurences, job_position_filter, company_occurences, company_filter, contact_occurences, contact_filter)) {

            // adding all data to the row. The order of the pushes match
            // the header order from the global array headers.
            //
            const thread_start_date = findDate(initial_messages[i], false)
            const thread_end_date = findDate(final_message_page, true)

            row.push(thread_start_date);
            row.push(thread_end_date);
            row.push(calculate_time_interval_in_days(thread_end_date, thread_start_date));
            row.push(getLink(initial_messages[i].file.name));
            row.push(getLink(final_message_page.file.name));
            row.push(message_count);
            row.push(job_occurences);
            row.push(company_occurences);
            row.push(contact_occurences);

            const average_days_to_draft = calculate_time_averages(total_draft_time, sent_message_counts)
            const average_days_to_respond = calculate_time_averages(total_response_time, response_message_counts)
            row.push(average_days_to_draft);
            row.push(average_days_to_respond);

            rows.push(row);
        }


    }


    // Create the table
    const table = dv.markdownTable(headers, rows.sort(Comparator));

    // Print the table
    dv.paragraph(table);

}


generate(input.job_position_filter, input.company_filter, input.contact_filter);

