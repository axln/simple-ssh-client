class Helper {
    static async delay(time) {
        return new Promise(resolve => {
            setTimeout(() => {
                resolve();
            }, time);
        })
    }
}

module.exports = Helper;