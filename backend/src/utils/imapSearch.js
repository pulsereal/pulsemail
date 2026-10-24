// Builds IMAP SEARCH criteria in the shape node-imap actually accepts.
//
// Two of its rules are easy to get wrong and neither is checked until the
// search runs against a real server:
//
//   * there is no AND key. Criteria listed in the top-level array are ANDed
//     implicitly, and passing a literal "AND" is rejected outright.
//   * OR is strictly binary. Three alternatives have to be folded into nested
//     pairs; `['OR', a, b, c]` throws "OR must have exactly two arguments".
//
// The top level must also be an array of criteria, so a single OR group still
// needs wrapping.

/** Folds any number of alternatives into the nested binary ORs node-imap wants. */
const anyOf = (alternatives) =>
    alternatives.length === 1
        ? alternatives[0]
        : ["OR", alternatives[0], anyOf(alternatives.slice(1))];

/** Discards unparseable input rather than emitting an Invalid Date. */
const asDate = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

const buildSearchCriteria = ({
    query,
    sender,
    subject,
    dateFrom,
    dateTo,
    hasAttachments,
} = {}) => {
    const criteria = [];

    if (query) {
        criteria.push(
            anyOf([
                ["SUBJECT", query],
                ["FROM", query],
                ["BODY", query],
            ])
        );
    }

    if (sender) criteria.push(["FROM", sender]);
    if (subject) criteria.push(["SUBJECT", subject]);

    const since = dateFrom ? asDate(dateFrom) : null;
    if (since) criteria.push(["SINCE", since]);

    const before = dateTo ? asDate(dateTo) : null;
    if (before) criteria.push(["BEFORE", before]);

    // Approximates "has an attachment": a multipart message usually does.
    if (hasAttachments) {
        criteria.push(["HEADER", "CONTENT-TYPE", "MULTIPART"]);
    }

    return criteria.length > 0 ? criteria : ["ALL"];
};

module.exports = { anyOf, buildSearchCriteria };
