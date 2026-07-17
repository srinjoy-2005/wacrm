const bcrypt = require('bcryptjs');
const readline = require('readline');

const SALT_ROUNDS = 10;

// Setup terminal input interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Prompt the user for the password
rl.question('Enter the password to hash: ', async (password) => {
  if (!password) {
    console.log('Password cannot be empty.');
    rl.close();
    return;
  }

  try {
    console.log('Hashing...');
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    
    console.log('\n--- Result ---');
    console.log(hashedPassword);
    console.log('--------------\n');
  } catch (error) {
    console.error('Error hashing password:', error.message);
  } finally {
    rl.close();
  }
});
