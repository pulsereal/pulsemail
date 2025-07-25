const { query } = require('../config/database');
const nodemailer = require('nodemailer');
const Imap = require('imap');
const { simpleParser } = require('mailparser');

class Email {
  constructor() {
    this.transporter = null;
    this.initializeTransporter();
  }

  // Initialize SMTP transporter
  initializeTransporter() {
    this.transporter = nodemailer.createTransporter({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }

  // Send email
  async sendEmail(from, to, subject, content, attachments = []) {
    try {
      const mailOptions = {
        from,
        to: Array.isArray(to) ? to.join(',') : to,
        subject,
        html: content,
        attachments
      };

      const result = await this.transporter.sendMail(mailOptions);
      
      // Log sent email
      await this.logSentEmail(from, to, subject, content, result.messageId);
      
      return result;
    } catch (error) {
      throw new Error(`Error sending email: ${error.message}`);
    }
  }

  // Log sent email to database
  async logSentEmail(from, to, subject, content, messageId) {
    try {
      await query(`
        INSERT INTO sent_emails (from_email, to_email, subject, content, message_id, sent_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
      `, [from, Array.isArray(to) ? to.join(',') : to, subject, content, messageId]);
    } catch (error) {
      console.error('Error logging sent email:', error);
    }
  }

  // Get emails using IMAP
  async getEmails(userEmail, folder = 'INBOX', limit = 50, offset = 0) {
    return new Promise((resolve, reject) => {
      const user = userEmail.split('@')[0];
      const domain = userEmail.split('@')[1];
      
      const imap = new Imap({
        user: userEmail,
        password: process.env.IMAP_PASS || 'temp', // This should be user's actual password
        host: process.env.IMAP_HOST,
        port: process.env.IMAP_PORT,
        tls: process.env.IMAP_SECURE === 'true'
      });

      const emails = [];

      imap.once('ready', () => {
        imap.openBox(folder, true, (err, box) => {
          if (err) {
            reject(err);
            return;
          }

          const totalMessages = box.messages.total;
          const start = Math.max(1, totalMessages - offset - limit + 1);
          const end = Math.max(1, totalMessages - offset);

          if (totalMessages === 0) {
            resolve([]);
            return;
          }

          const fetch = imap.seq.fetch(`${start}:${end}`, {
            bodies: 'HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)',
            struct: true
          });

          fetch.on('message', (msg, seqno) => {
            const email = { seqno };

            msg.on('body', (stream, info) => {
              let buffer = '';
              stream.on('data', (chunk) => {
                buffer += chunk.toString('ascii');
              });
              stream.once('end', () => {
                const parsed = Imap.parseHeader(buffer);
                email.from = parsed.from?.[0] || '';
                email.to = parsed.to?.[0] || '';
                email.subject = parsed.subject?.[0] || '';
                email.date = parsed.date?.[0] || '';
                email.messageId = parsed['message-id']?.[0] || '';
              });
            });

            msg.once('attributes', (attrs) => {
              email.uid = attrs.uid;
              email.flags = attrs.flags;
              email.size = attrs.size;
            });

            msg.once('end', () => {
              emails.push(email);
            });
          });

          fetch.once('error', (err) => {
            reject(err);
          });

          fetch.once('end', () => {
            imap.end();
            resolve(emails.reverse()); // Most recent first
          });
        });
      });

      imap.once('error', (err) => {
        reject(err);
      });

      imap.connect();
    });
  }

  // Get single email content
  async getEmailContent(userEmail, uid, folder = 'INBOX') {
    return new Promise((resolve, reject) => {
      const imap = new Imap({
        user: userEmail,
        password: process.env.IMAP_PASS || 'temp',
        host: process.env.IMAP_HOST,
        port: process.env.IMAP_PORT,
        tls: process.env.IMAP_SECURE === 'true'
      });

      imap.once('ready', () => {
        imap.openBox(folder, true, (err, box) => {
          if (err) {
            reject(err);
            return;
          }

          const fetch = imap.fetch(uid, { bodies: '' });
          let emailContent = '';

          fetch.on('message', (msg, seqno) => {
            msg.on('body', (stream, info) => {
              stream.on('data', (chunk) => {
                emailContent += chunk.toString();
              });
            });

            msg.once('end', () => {
              simpleParser(emailContent)
                .then(parsed => {
                  resolve({
                    from: parsed.from,
                    to: parsed.to,
                    subject: parsed.subject,
                    date: parsed.date,
                    html: parsed.html,
                    text: parsed.text,
                    attachments: parsed.attachments || []
                  });
                })
                .catch(reject);
            });
          });

          fetch.once('error', reject);
          fetch.once('end', () => imap.end());
        });
      });

      imap.once('error', reject);
      imap.connect();
    });
  }

  // Mark email as read/unread
  async markEmail(userEmail, uid, flag, add = true) {
    return new Promise((resolve, reject) => {
      const imap = new Imap({
        user: userEmail,
        password: process.env.IMAP_PASS || 'temp',
        host: process.env.IMAP_HOST,
        port: process.env.IMAP_PORT,
        tls: process.env.IMAP_SECURE === 'true'
      });

      imap.once('ready', () => {
        imap.openBox('INBOX', false, (err, box) => {
          if (err) {
            reject(err);
            return;
          }

          const action = add ? 'addFlags' : 'delFlags';
          imap[action](uid, flag, (err) => {
            if (err) {
              reject(err);
            } else {
              resolve(true);
            }
            imap.end();
          });
        });
      });

      imap.once('error', reject);
      imap.connect();
    });
  }

  // Get email folders
  async getFolders(userEmail) {
    return new Promise((resolve, reject) => {
      const imap = new Imap({
        user: userEmail,
        password: process.env.IMAP_PASS || 'temp',
        host: process.env.IMAP_HOST,
        port: process.env.IMAP_PORT,
        tls: process.env.IMAP_SECURE === 'true'
      });

      imap.once('ready', () => {
        imap.getBoxes((err, boxes) => {
          if (err) {
            reject(err);
          } else {
            resolve(boxes);
          }
          imap.end();
        });
      });

      imap.once('error', reject);
      imap.connect();
    });
  }

  // Search emails
  async searchEmails(userEmail, criteria, folder = 'INBOX') {
    return new Promise((resolve, reject) => {
      const imap = new Imap({
        user: userEmail,
        password: process.env.IMAP_PASS || 'temp',
        host: process.env.IMAP_HOST,
        port: process.env.IMAP_PORT,
        tls: process.env.IMAP_SECURE === 'true'
      });

      imap.once('ready', () => {
        imap.openBox(folder, true, (err, box) => {
          if (err) {
            reject(err);
            return;
          }

          imap.search(criteria, (err, results) => {
            if (err) {
              reject(err);
              return;
            }

            if (results.length === 0) {
              resolve([]);
              imap.end();
              return;
            }

            const fetch = imap.fetch(results, {
              bodies: 'HEADER.FIELDS (FROM TO SUBJECT DATE)',
              struct: true
            });

            const emails = [];

            fetch.on('message', (msg, seqno) => {
              const email = { seqno };

              msg.on('body', (stream, info) => {
                let buffer = '';
                stream.on('data', (chunk) => {
                  buffer += chunk.toString('ascii');
                });
                stream.once('end', () => {
                  const parsed = Imap.parseHeader(buffer);
                  email.from = parsed.from?.[0] || '';
                  email.to = parsed.to?.[0] || '';
                  email.subject = parsed.subject?.[0] || '';
                  email.date = parsed.date?.[0] || '';
                });
              });

              msg.once('attributes', (attrs) => {
                email.uid = attrs.uid;
                email.flags = attrs.flags;
              });

              msg.once('end', () => {
                emails.push(email);
              });
            });

            fetch.once('error', reject);
            fetch.once('end', () => {
              imap.end();
              resolve(emails);
            });
          });
        });
      });

      imap.once('error', reject);
      imap.connect();
    });
  }

  // Get email statistics for dashboard
  static async getEmailStats(userEmail) {
    try {
      const result = await query(`
        SELECT 
          COUNT(*) as total_sent,
          COUNT(CASE WHEN sent_at >= NOW() - INTERVAL '7 days' THEN 1 END) as sent_this_week,
          COUNT(CASE WHEN sent_at >= NOW() - INTERVAL '30 days' THEN 1 END) as sent_this_month
        FROM sent_emails 
        WHERE from_email = $1
      `, [userEmail]);

      return result.rows[0] || { total_sent: 0, sent_this_week: 0, sent_this_month: 0 };
    } catch (error) {
      return { total_sent: 0, sent_this_week: 0, sent_this_month: 0 };
    }
  }

  // Delete email
  async deleteEmail(userEmail, uid, folder = 'INBOX') {
    return new Promise((resolve, reject) => {
      const imap = new Imap({
        user: userEmail,
        password: process.env.IMAP_PASS || 'temp',
        host: process.env.IMAP_HOST,
        port: process.env.IMAP_PORT,
        tls: process.env.IMAP_SECURE === 'true'
      });

      imap.once('ready', () => {
        imap.openBox(folder, false, (err, box) => {
          if (err) {
            reject(err);
            return;
          }

          imap.addFlags(uid, '\\Deleted', (err) => {
            if (err) {
              reject(err);
              return;
            }

            imap.expunge((err) => {
              if (err) {
                reject(err);
              } else {
                resolve(true);
              }
              imap.end();
            });
          });
        });
      });

      imap.once('error', reject);
      imap.connect();
    });
  }

  // Move email to folder
  async moveEmail(userEmail, uid, targetFolder, sourceFolder = 'INBOX') {
    return new Promise((resolve, reject) => {
      const imap = new Imap({
        user: userEmail,
        password: process.env.IMAP_PASS || 'temp',
        host: process.env.IMAP_HOST,
        port: process.env.IMAP_PORT,
        tls: process.env.IMAP_SECURE === 'true'
      });

      imap.once('ready', () => {
        imap.openBox(sourceFolder, false, (err, box) => {
          if (err) {
            reject(err);
            return;
          }

          imap.move(uid, targetFolder, (err) => {
            if (err) {
              reject(err);
            } else {
              resolve(true);
            }
            imap.end();
          });
        });
      });

      imap.once('error', reject);
      imap.connect();
    });
  }
}

module.exports = Email;
