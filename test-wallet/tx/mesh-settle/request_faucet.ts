/**
 * Request test ADA from Cardano Preprod Faucet
 * Uses the official IOHK faucet API
 */

const FAUCET_API_URL = "https://faucet.cardano.org/api/v0/request";
const ADDRESS = "addr_test1qqjy0kc8uwmnkqxnewdjw8jz7nj8tkyz6p5ranjr035rvlfyglds0cah8vqd8jumyu0y9a8ywhvg95rg8m8yxlrgxe7scjfqze";

async function requestFaucet(address: string): Promise<any> {
  console.log(`Requesting test ADA for: ${address}`);
  
  try {
    const response = await fetch(FAUCET_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        address: address,
        network: "preprod",
      }),
    });
    
    const data = await response.json();
    console.log("Response:", data);
    return data;
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
}

requestFaucet(ADDRESS)
  .then((result) => {
    if (result.success) {
      console.log("\n✅ Faucet request successful!");
      console.log("Funds should arrive in a few minutes.");
    } else {
      console.log("\n❌ Faucet request failed:", result.message);
    }
  })
  .catch(console.error);
