const baseURL = "rehabranger.ai";

export const getServiceUrl = (activityData) => {
  return {
    // EXERCISE_SERVICE: `https://${activityData?.tenant}.${baseURL}/exercise-service`,
    // USER_SERVICE: `https://${activityData?.tenant}.${baseURL}/user-service`,
    EXERCISE_SERVICE: `http://34.233.242.35/exercise-service`,
    USER_SERVICE: `http://34.233.242.35/user-service`,
  };
};
